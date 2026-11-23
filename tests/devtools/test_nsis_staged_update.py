"""Source contracts for the Windows installer; real execution lives in installer/."""

import fnmatch
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")
# Folders in the install folder that hold the user's own files, which "Delete AppData" keeps:
# model folders put there for versions before #597, and exported vocabulary files.
KEPT_USER_FOLDERS = ("translation-models", "exports")


def block(kind, name):
    return SOURCE.split(f"\n{kind} {name}\n", 1)[1].split(f"\n{kind}End", 1)[0]


class NsisStagedUpdateTests(unittest.TestCase):
    def test_upgrade_choice_records_uninstall_and_returns(self):
        leave = block("Function", "PageLeaveReinstall")
        upgrade = leave.split('${If} $R5 == "1"', 1)[1].split("HideWindow", 1)[0]
        self.assertNotIn("ExecWait", upgrade)
        self.assertIn("Return", upgrade)
        for variable in ("deferred_kind", "deferred_uninstall", "deferred_location"):
            self.assertIn(f'StrCpy ${variable} ""', leave)
            self.assertIn(f"${variable}", upgrade)
        self.assertIn("ExecWait", leave.split("HideWindow", 1)[1])

    def test_extraction_is_staged_and_validated(self):
        install = block("Section", "Install")
        tar = next(line for line in install.splitlines() if "-xvf" in line)
        validated = install.split(tar, 1)[1].split("attempt_failed:", 1)[0]
        self.assertIn('${If} $0 == 0', validated)
        self.assertIn('${FileExists} "$INSTDIR\\.upd\\new\\${MAINBINARYNAME}.exe"', validated)
        self.assertIn('${FileExists} "$INSTDIR\\.upd\\new\\_internal\\*.*"', validated)
        self.assertEqual(install.count("Call CheckAppIsRunning"), 2)
        self.assertNotIn("!insertmacro CheckIfAppIsRunning", install)

    def test_tar_arguments_stay_ascii_without_8dot3_names(self):
        # tar.exe reads its arguments in the ANSI code page, and a volume may
        # have no 8.3 names. Only the working directory can carry Unicode.
        self.assertNotIn("GetFullPathName /SHORT", SOURCE)
        install = block("Section", "Install")
        tar = next(line for line in install.splitlines() if "-xvf" in line)
        self.assertEqual(tar.strip(), """nsExec::ExecToLog '"$SYSDIR\\tar.exe" -xvf "..\\$file_name"'""")
        self.assertTrue(install.split('SOFTWARE_DOWNLOAD_FILENAME "', 1)[1].split('"', 1)[0].isascii())
        before, after = install.split(tar, 1)
        before = before.rsplit('DetailPrint "Extracting', 1)[1]
        self.assertRegex(before, r'Rename "\$download_dir\\\$file_name" "\$INSTDIR\\\.upd\\\$file_name"\n\s*IfErrors attempt_failed')
        # A failed SetOutPath must not let tar unpack into the old directory.
        self.assertRegex(before, r'SetOutPath "\$INSTDIR\\\.upd\\new"\n\s*\$\{IfNot\} \$\{Errors\}')
        # Leave the staging tree before retrying, committing or removing it.
        self.assertLess(after.index('SetOutPath "$TEMP"'), after.index("${If} $0 == 0"))
        # A retry must not trip over an archive that could not be moved back.
        attempt = install.split("install_attempt:", 1)[1].split("${If} $dl_parallel", 1)[0]
        self.assertIn('Delete "$INSTDIR\\.upd\\$file_name"', attempt)
        failed = after.split("attempt_failed:", 1)[0]
        self.assertIn('Rename "$INSTDIR\\.upd\\$file_name" "$download_dir\\$file_name"', failed)

    def test_a_hash_mismatch_downloads_again_before_giving_up(self):
        # Issue #424: a truncated transfer shows up as a SHA-256 mismatch; it is retried like any
        # other failure, on a single connection, and only the third one stops the install.
        install = block("Section", "Install")
        mismatch = install.split("${If} $actual_package_hash != $expected_package_hash", 1)[1].split("${EndIf}", 1)[0]
        self.assertNotIn("Abort", mismatch)
        self.assertNotIn("MessageBox", mismatch)
        self.assertIn('StrCpy $dl_hash_failed "1"', mismatch)
        self.assertIn('StrCpy $dl_parallel "0"', mismatch)
        self.assertEqual(mismatch.strip().splitlines()[-1].strip(), "Goto attempt_failed")
        attempt = install.split("install_attempt:", 1)[1].split("${If} $dl_parallel != \"1\"", 1)[0]
        self.assertIn('StrCpy $dl_hash_failed "0"', attempt)
        failed = install.split("attempt_failed:", 1)[1].split("install_ready:", 1)[0]
        retry, give_up = failed.split("Goto install_attempt", 1)
        self.assertIn("${If} $dl_retries < 3", retry)
        hash_failed = give_up.split('${If} $dl_hash_failed == "1"', 1)[1].split("${EndIf}", 1)[0]
        self.assertIn("failed SHA-256 verification. Installation was aborted.", hash_failed)
        self.assertLess(hash_failed.index("Call CleanupFailedInstall"), hash_failed.index("Abort"))
        # A package that failed verification is never kept as the .bad archive.
        self.assertLess(hash_failed.index('Delete "$download_dir\\$file_name"'), hash_failed.index("Abort"))

    def test_a_slow_single_download_is_cut_only_when_it_stalls_and_then_continues(self):
        install = block("Section", "Install")
        single = install.split("download_wait:", 1)[1].split("single_download_done:", 1)[0]
        self.assertIn('"@XFERSIZE_B@"', single)
        self.assertNotIn("3600", single)
        self.assertIn("${If} $R4 >= 600", single)
        self.assertEqual(single.count('StrCpy $dl_resume "1"'), 2)
        # Only that file survives into the next attempt, where NScurl /RESUME continues it.
        attempt = install.split("install_attempt:", 1)[1].split("${If} $dl_parallel != \"1\"", 1)[0]
        kept = attempt.split('${If} $dl_resume != "1"', 1)[1].split("${EndIf}", 1)[0]
        self.assertIn('Delete "$download_dir\\$file_name"', kept)
        self.assertLess(attempt.index("${EndIf}", attempt.index(kept)), attempt.index('StrCpy $dl_resume "0"'))
        self.assertIn('NScurl::http GET "$cmder_dl" "$download_dir\\$file_name" /INSIST /RESUME', install)

    def test_a_successful_install_removes_the_archive_a_failed_one_kept(self):
        ready = block("Section", "Install").split("install_ready:", 1)[1]
        self.assertLess(ready.index('Delete "$TEMP\\$file_name.bad"'), ready.index("Call CheckAppIsRunning"))

    def test_install_volume_budgets_the_archive_on_another_drive(self):
        install = block("Section", "Install")
        self.assertIn("IntOp $R4 $req_dl_mb + $req_extract_mb", install)
        separate = install.split("${If} $R0 == $R1", 1)[1].split("${Else}", 1)[1].split("A fork installer", 1)[0]
        self.assertIn("${AndIf} $R3 < $R4", separate)

    def test_transaction_renames_check_errors(self):
        for name in ("CommitStagedEntry", "RollbackInstall", "DiscardInstalledEntry"):
            code = block("Function", name)
            self.assertRegex(code, r"(?m)^\s*Rename ")
            for match in re.finditer(r"(?m)^\s*Rename [^\n]+\n([^\n]+)", code):
                self.assertRegex(match[1], r"^\s*IfErrors ")
        install = block("Section", "Install")
        commit = install.split("install_ready:", 1)[1]
        for match in re.finditer(r"(?m)^\s*Rename [^\n]+\n([^\n]+)", commit):
            self.assertRegex(match[1], r"^\s*IfErrors ")
        self.assertRegex(commit, r'WriteUninstaller [^\n]+\n\s*IfErrors commit_failed')
        self.assertIn('FileOpen $0 "$INSTDIR\\.upd\\add\\uninstall.exe" w', commit)
        self.assertLess(commit.index('StrCpy $upd_entry "${MAINBINARYNAME}.exe"'),
                        commit.index("commit_next:"))

    def test_marker_precedes_mutations_and_is_removed_before_cleanup(self):
        install = block("Section", "Install")
        commit = install.split("install_ready:", 1)[1]
        self.assertLess(commit.index('"$INSTDIR\\.upd\\committing" w'), commit.index("Rename "))
        for code in (commit, block("Function", "RollbackInstall")):
            self.assertLess(code.index('Delete "$INSTDIR\\.upd\\committing"'),
                            code.index('RMDir /r "$INSTDIR\\.upd"'))
        rollback = block("Function", "RollbackInstall")
        failure = rollback.split("rollback_failed:", 1)[1]
        self.assertNotIn("RMDir", failure)
        self.assertNotIn("Delete", failure)

    def test_enumeration_closes_before_mutation(self):
        enum = block("Function", "FirstUpdateEntry")
        self.assertIn("FindFirst", enum)
        self.assertIn("FindClose", enum)
        self.assertNotIn("Rename", enum)
        for name in ("CommitStagedEntry", "RollbackInstall", "DiscardInstalledEntry"):
            self.assertNotIn("FindFirst", block("Function", name))

    def test_cleanup_retries_rollback_and_preserves_failed_restore(self):
        cleanup = block("Function", "CleanupFailedInstall")
        self.assertIn("Call CleanupFailedInstall", block("Function", ".onInstFailed"))
        self.assertIn("Call RollbackInstall", cleanup)
        self.assertIn('${IfThen} $upd_failed == "1" ${|} Return ${|}', cleanup)
        self.assertNotIn('Delete "$INSTDIR', cleanup)
        self.assertIn('RMDir "$INSTDIR"', cleanup)
        self.assertIn('RmDir /r "$INSTDIR\\.upd"', block("Section", "Uninstall"))

    def test_package_transfers_stop_before_file_reuse(self):
        http = [line for line in SOURCE.splitlines() if "NScurl::http" in line]
        self.assertEqual(len(http), 6)
        for line in http:
            self.assertIn('/TAG "package"', line)
        stop = block("Function", "StopPackageTransfers")
        self.assertLess(stop.index("NScurl::cancel"), stop.index("NScurl::wait"))
        self.assertIn('/TAG "package"', stop)
        install = block("Section", "Install")
        for label in ("install_attempt:", "attempt_failed:"):
            first = install.split(label, 1)[1].strip().splitlines()[0]
            self.assertEqual(first, "Call StopPackageTransfers")
        cleanup = block("Function", "CleanupFailedInstall")
        self.assertLess(cleanup.index("Call StopPackageTransfers"), cleanup.index('RMDir /r "$download_dir"'))

    def test_deferred_uninstall_order_and_location_guard(self):
        install = block("Section", "Install")
        commit = install.split("install_ready:", 1)[1]
        self.assertLess(commit.index('$deferred_kind == "wix"'), commit.index("WriteUninstaller"))
        self.assertLess(commit.index("WriteUninstaller"), commit.index('$deferred_kind == "nsis"'))
        self.assertLess(commit.index('$deferred_kind == "nsis"'), commit.index("WriteRegStr"))
        self.assertIn('${AndIf} $deferred_location != $INSTDIR', commit)
        # An unknown location could be $INSTDIR, where UninstallString now names
        # the uninstaller just written; running it would delete the new app.
        self.assertIn('${AndIf} $deferred_location != ""', commit)
        self.assertIn('${AndIf} $deferred_uninstall != ""', commit)
        self.assertIn('/P _?=$deferred_location', commit)
        # If retiring the marker fails, rollback must precede irreversible
        # old-location removal and registry changes.
        self.assertLess(commit.index('Delete "$INSTDIR\\.upd\\committing"'),
                        commit.index('$deferred_kind == "nsis"'))


class NsisOneRunAtATimeTests(unittest.TestCase):
    """An in-app update (/P /UPDATE /R) and a setup started by hand must not overlap: both empty
    $INSTDIR\\.upd when they start. The real runs are in tests/installer/."""

    def code(self, text):
        return [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith(";")]

    def test_a_second_run_stops_before_it_changes_anything(self):
        init = self.code(block("Function", ".onInit"))
        # The first thing the installer does, before the registry, the pages and the downloads.
        self.assertTrue(init[0].startswith("System::Call 'kernel32::CreateMutexW(p 0, i 0, w \"${INSTALLERMUTEX}\") p .r1 ?e'"), init[0])
        guard = init[:init.index("${EndIf}") + 1]
        self.assertIn("${If} $0 = 183 ; ERROR_ALREADY_EXISTS", guard)
        self.assertIn("${OrIf} $0 = 5 ; ERROR_ACCESS_DENIED", guard)
        self.assertIn("Call AnotherRunIsActive", guard)
        # The handle stays open for the whole run; Windows closes it when the run ends.
        self.assertNotIn("CloseHandle", SOURCE)
        # A fixed name, so that it does not change with the registry names.
        name = SOURCE.split('!define INSTALLERMUTEX "', 1)[1].split('"', 1)[0]
        self.assertEqual(name, "Local\\ASTAROT-setup")
        # The uninstaller does not take it: the installer runs the uninstaller and waits for it.
        self.assertNotIn("INSTALLERMUTEX", block("Function", "un.onInit"))

    def test_the_second_run_says_so_and_exits_with_code_2(self):
        another = block("Function", "AnotherRunIsActive")
        for word in ("Delete", "RMDir", "Rename", "WriteReg", "DeleteReg", "NScurl", "Exec"):
            self.assertNotIn(word, another)
        silent, shown = another.split("another_run_message:", 1)
        self.assertIn('FileWrite $0 "$(anotherRunIsActive)$\\n"', silent)
        self.assertIn('MessageBox MB_OK|MB_ICONEXCLAMATION "$(anotherRunIsActive)" /SD IDOK', shown)
        self.assertLess(shown.index("SetErrorLevel 2"), shown.index("Quit"))
        conf = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
        for language in conf["bundle"]["windows"]["nsis"]["languages"]:
            self.assertRegex(SOURCE, rf"LangString anotherRunIsActive \$\{{LANG_{language.upper()}\}} \"[^\"]+\"")

    def test_downloads_go_to_a_folder_of_the_run(self):
        init = block("Function", ".onInit")
        self.assertLess(init.index("InitPluginsDir"), init.index('StrCpy $download_dir "$PLUGINSDIR\\package"'))
        # In $TEMP itself only the archive a failed install keeps for diagnosis.
        for line in self.code(SOURCE):
            for use in re.findall(r"\$TEMP\\[^\"\s$]*(?:\$file_name[^\"\s$]*)?", line):
                self.assertEqual(use, "$TEMP\\$file_name.bad", line)
        install = block("Section", "Install")
        self.assertLess(install.index('CreateDirectory "$download_dir"'), install.index("NScurl::http"))
        ready = install.split("install_ready:", 1)[1]
        self.assertLess(ready.index('RMDir /r "$download_dir"'), ready.index("Call CheckAppIsRunning"))
        # Removed however the run stops, even before it owns work files in $INSTDIR.
        cleanup = block("Function", "CleanupFailedInstall")
        self.assertLess(cleanup.index('RMDir /r "$download_dir"'), cleanup.index("$install_started"))
        webview = block("Section", "WebView2")
        self.assertIn('CreateDirectory "$download_dir"', webview)
        self.assertNotIn("$TEMP", "\n".join(self.code(webview)))


class NsisAppProcessAndDataTests(unittest.TestCase):
    def test_running_check_also_stops_the_sidecar_of_an_older_install(self):
        # Packages up to 0.4 carried the Python sidecar; 0.5.0 has none (tauri.conf.json lists no
        # externalBin), but an install being updated may still run one.
        conf = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
        self.assertNotIn("externalBin", conf["bundle"])
        self.assertIn('!define SIDECARBINARYNAME "vrct-vox-sidecar"', SOURCE)
        macro = SOURCE.split("\n!macro CheckIfAppIsRunning\n", 1)[1].split("\n!macroend", 1)[0]
        # Killing an older vrct-vox.exe skipped the shell plugin's exit handler, which
        # is what normally stopped the sidecar.
        after_app = macro.split("app_check_done:", 1)[1]
        self.assertIn('!insertmacro StopLeftoverProcess "${SIDECARBINARYNAME}.exe"', after_app)
        stop = SOURCE.split("\n!macro StopLeftoverProcess name\n", 1)[1].split("\n!macroend", 1)[0]
        for call in ("FindProcessCurrentUser", "KillProcessCurrentUser", "FindProcess", "KillProcess"):
            self.assertIn(f'nsis_tauri_utils::{call} "${{name}}"', stop)
        self.assertIn('Abort "$(failedToKillApp)"', stop)
        uninstall = block("Section", "Uninstall")
        self.assertLess(uninstall.index("!insertmacro CheckIfAppIsRunning"), uninstall.index("Delete "))
        # The stale sidecar goes with the uninstall too.
        self.assertIn('Delete "$INSTDIR\\${SIDECARBINARYNAME}.exe"', uninstall)

    def test_no_components_page(self):
        # Every section is required; the page let users skip the app or WebView2.
        code = [line for line in SOURCE.splitlines() if not line.lstrip().startswith(";")]
        self.assertFalse([line for line in code if "MUI_PAGE_COMPONENTS" in line])

    def opted_in(self):
        uninstall = block("Section", "Uninstall")
        return uninstall, uninstall.split("${If} $DeleteAppDataCheckboxState == 1", 1)[1].split("\n  ${EndIf}", 1)[0]

    def test_delete_app_data_covers_state_next_to_config(self):
        uninstall, opted_in = self.opted_in()
        for line in ('RmDir /r "$INSTDIR\\downloaded_models"', 'Delete "$INSTDIR\\voice_mute_state.json"',
                     'Delete "$INSTDIR\\config.json"', 'RmDir /r "$INSTDIR\\weights"',
                     # The registered models (#403), listed in docs/spec/data-and-persistence.md.
                     'Delete "$INSTDIR\\user_models.json"',
                     # The translation catalog (#413), the keys' id and the files set aside next to
                     # both (lock, unreadable-*, before-migration-*, temporary files).
                     'Delete "$INSTDIR\\translation_catalog.json"', 'Delete "$INSTDIR\\secrets.json"',
                     'Delete "$INSTDIR\\config.json.*"', 'Delete "$INSTDIR\\secrets.json.*"',
                     'Delete "$INSTDIR\\startup_timing.log"'):
            self.assertIn(line, opted_in)
            # Kept when the box is not ticked, e.g. when an update moves the install.
            self.assertEqual(uninstall.count(line), 1)

    def test_delete_app_data_covers_the_files_the_spec_lists(self):
        # Every file and folder docs/spec/data-and-persistence.md places next to config.json or in
        # PATH_DATA (the install folder on Windows) goes, or is one of the user's own folders.
        _uninstall, opted_in = self.opted_in()
        patterns = re.findall(r'(?m)^\s*Delete "\$INSTDIR\\([^"]+)"', opted_in)
        folders = re.findall(r'(?m)^\s*RmDir /r "\$INSTDIR\\([^"\\]+)"', opted_in)
        spec = (ROOT / "docs/spec/data-and-persistence.md").read_text(encoding="utf-8")
        table = spec.split("## そのほかのファイル", 1)[1].split("\n## ", 1)[0]
        names = []
        for row in table.splitlines()[2:]:
            cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
            if len(cells) < 2:
                continue
            place = cells[1].replace("`", "")
            if "PATH_LOGS" in place or "/logs/" in place:
                names.append("logs")
            elif "config.jsonと同じフォルダ" in place or place == "PATH_DATA":
                # The first name of a row is what lies in the folder (a row may go on with the
                # files inside it, such as receipt.json).
                names.append((re.findall(r"`([^`]+)`", cells[0]) or [cells[0]])[0])
        for name in ("secrets.json", "telemetry_state.json", "logs", "weights/whisper/…"):
            self.assertIn(name, names)
        for name in names:
            top = re.sub(r"<[^>]+>", "x", name).split("/", 1)[0].rstrip("…")
            with self.subTest(name=name):
                if top in KEPT_USER_FOLDERS:
                    self.assertNotIn(top, folders)
                    continue
                self.assertTrue(top in folders or any(fnmatch.fnmatchcase(top, pattern) for pattern in patterns), top)

    def test_the_users_own_folders_stay(self):
        uninstall, opted_in = self.opted_in()
        for folder in KEPT_USER_FOLDERS:
            self.assertNotIn(f"\\{folder}", uninstall.replace(f'"$INSTDIR\\{folder}\\*.*"', ""))
            self.assertIn(f'${{FileExists}} "$INSTDIR\\{folder}\\*.*"', opted_in)

    def test_secrets_json_stays_while_a_key_of_this_folder_is_left(self):
        # Decided on #1011: the id another uninstall needs to remove the rest stays with them.
        _uninstall, opted_in = self.opted_in()
        guarded = opted_in[opted_in.index('${If} $keys_left != "1"'):]
        self.assertLess(guarded.index('Delete "$INSTDIR\\secrets.json"'), guarded.index("${EndIf}"))
        for language in ("English", "Japanese"):
            message = re.search(rf'LangString keysLeft \$\{{LANG_{language.upper()}\}} "([^"]*)"', SOURCE).group(1)
            self.assertIn("secrets.json", message)

    def test_delete_app_data_removes_this_folders_keys_first(self):
        _uninstall, opted_in = self.opted_in()
        self.assertLess(opted_in.index("Call un.DeleteStoredKeys"), opted_in.index('Delete "$INSTDIR\\secrets.json"'))
        # The prefixes the app writes, and 0.6.0's (credentials::WINDOWS_PREFIX).
        identity = (ROOT / "native/app-identity/src/lib.rs").read_text(encoding="utf-8")
        older, current = re.search(r'WINDOWS_PREFIX: Renamed = Renamed::moved\("([^"]+)", "([^"]+)"\)', identity).groups()
        self.assertIn(f'!define CREDENTIALPREFIX "{current}"', SOURCE)
        self.assertIn(f'!define OLDCREDENTIALPREFIX "{older}"', SOURCE)
        keys = block("Function", "un.DeleteStoredKeys")
        self.assertLess(keys.index("Call un.ReadStoreId"), keys.index('${If} $store_id == ""'))
        self.assertLess(keys.index('${If} $store_id == ""'), keys.index("Return"))
        for prefix in ("CREDENTIALPREFIX", "OLDCREDENTIALPREFIX"):
            self.assertIn(f'!insertmacro DeleteCredentials "${{{prefix}}}"', keys)
        macro = SOURCE.split("\n!macro DeleteCredentials prefix\n", 1)[1].split("\n!macroend", 1)[0]
        # Only this folder's names: the filter, and each name compared again before it goes.
        self.assertIn('CredEnumerateW(w "${prefix}/$store_id/*"', macro)
        self.assertIn('${AndIf} $5 == "${prefix}/$store_id/"', macro)
        self.assertIn("${If} $8 = 1 ; CRED_TYPE_GENERIC", macro)
        self.assertLess(macro.index('${AndIf} $5 == "${prefix}/$store_id/"'), macro.index("CredDeleteW"))
        self.assertIn("CredFree", macro)
        # The id is used only when it has the form the app makes.
        read = block("Function", "un.ReadStoreId")
        self.assertIn('FileOpen $0 "$INSTDIR\\secrets.json" r', read)
        self.assertIn("""${If} $2 S== '"store_id"'""", read)
        self.assertLess(read.index("Call un.IsStoreId"), read.index("StrCpy $store_id $2"))
        valid = block("Function", "un.IsStoreId")
        self.assertIn("${If} $1 = 16", valid)
        self.assertIn('"0123456789abcdef"', valid)
        self.assertIn("${If} $4 S== $2", valid)
        secrets = (ROOT / "native/core/src/config/secrets.rs").read_text(encoding="utf-8")
        self.assertIn("id.len() == 16 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))", secrets)
        # Keys that stay are named to the user, who can remove them in the Credential Manager.
        conf = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
        for language in conf["bundle"]["windows"]["nsis"]["languages"]:
            self.assertRegex(SOURCE, rf'LangString keysLeft \$\{{LANG_{language.upper()}\}} "[^"]*\$\{{CREDENTIALPREFIX\}}/\$store_id/[^"]*\$\{{OLDCREDENTIALPREFIX\}}/\$store_id/')



class NsisInstallFolderMoveTests(unittest.TestCase):
    """ADR-014, 2.5: the keys move to ASTAROT, and the default folder up to 0.5.0 moves with them."""

    def test_the_previous_install_is_read_from_the_new_keys_then_the_old_ones(self):
        read = block("Function", "ReadPreviousInstall")
        self.assertLess(read.index('SHCTX "${MANUPRODUCTKEY}" ""'), read.index('SHCTX "${OLDMANUPRODUCTKEY}" ""'))
        self.assertLess(read.index('SHCTX "${UNINSTKEY}" "UninstallString"'),
                        read.index('SHCTX "${OLDUNINSTKEY}" "UninstallString"'))
        on_init = block("Function", ".onInit")
        # Also with /D=: the reinstall page and the removal of the old keys use it.
        self.assertLess(on_init.index("!insertmacro SetContext"), on_init.index("Call ReadPreviousInstall"))
        self.assertLess(on_init.index("Call ReadPreviousInstall"), on_init.index('${If} $INSTDIR == ""'))
        # The pages read the entry that was found, never one key alone.
        for name in ("PageReinstall", "PageLeaveReinstall"):
            code = block("Function", name)
            self.assertNotIn('"${UNINSTKEY}"', code)
            self.assertNotIn('"${MANUPRODUCTKEY}"', code)
            self.assertIn('"$PrevUninstKey"', code)
        self.assertIn("StrCpy $deferred_location $PrevInstallLocation", block("Function", "PageLeaveReinstall"))

    def test_the_installer_language_moves_to_the_new_key_before_anything_reads_it(self):
        on_init = block("Function", ".onInit")
        carry = on_init.index('ReadRegStr $0 HKCU "${OLDMANUPRODUCTKEY}" "Installer Language"')
        self.assertLess(on_init.index('ReadRegStr $0 HKCU "${MANUPRODUCTKEY}" "Installer Language"'), carry)
        self.assertIn('WriteRegStr HKCU "${MANUPRODUCTKEY}" "Installer Language" $0', on_init)
        # Before /UILANG= overrides it and before the language dialog reads it.
        self.assertLess(carry, on_init.index('${If} $UILang == "en"'))
        self.assertLess(carry, on_init.index("MUI_LANGDLL_DISPLAY"))
        self.assertIn('!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"', SOURCE)

    def test_only_the_old_default_folder_is_planned_to_move(self):
        restore = block("Function", "RestorePreviousInstallLocation")
        self.assertIn('!insertmacro SameFolder "" "$INSTDIR" "$LOCALAPPDATA\\${OLDINSTALLFOLDER}" $0', restore)
        planned = restore.split('${If} $0 == "1"', 1)[1].split("${EndIf}", 1)[0]
        self.assertLess(planned.index("StrCpy $MoveFrom $INSTDIR"), planned.index("StrCpy $INSTDIR $MoveTo"))
        self.assertIn('StrCpy $MoveTo "$LOCALAPPDATA\\${PRODUCTNAME}"', restore)
        # Folders are compared as Windows names them: long names, no trailing separator, no case.
        normalize = SOURCE.split("Function ${un}NormalizeFolderPath\n", 1)[1].split("FunctionEnd", 1)[0]
        self.assertIn("kernel32::GetLongPathName", normalize)
        self.assertIn("kernel32::GetFullPathName", normalize)
        self.assertNotIn("StrCmpS", SOURCE.split("!macro SameFolder", 1)[1].split("!macroend", 1)[0])

    def test_the_install_is_updated_where_it_is_and_moves_once_the_new_files_are_in(self):
        install = block("Section", "Install")
        decide = install.split('StrCpy $move_pending "0"', 1)[1].split("StrCpy $existing_install", 1)[0]
        self.assertIn('!insertmacro SameFolder "" "$INSTDIR" "$MoveTo" $0', decide)
        self.assertIn('${AndIf} ${FileExists} "$MoveFrom\\*.*"', decide)
        self.assertIn("StrCpy $INSTDIR $MoveFrom", decide)
        # The processes stop and a leftover .upd is put right in the folder that moves, as before.
        self.assertLess(install.index('StrCpy $move_pending "0"'), install.index("Call CheckAppIsRunning"))
        self.assertLess(install.index('StrCpy $move_pending "0"'), install.index('RMDir /r "$INSTDIR\\.upd"'))
        commit = install.split("install_ready:", 1)[1]
        move = commit.index("Call MoveInstallFolder")
        self.assertLess(commit.index('Delete "$INSTDIR\\.upd\\committing"'), move)
        self.assertLess(commit.index('$deferred_kind == "nsis"'), move)
        self.assertLess(commit.index("WriteUninstaller"), move)
        # The shortcuts of an install that came from the old default folder lead to the new one
        # before any key records it there; the old keys go only after the new ones are written.
        repoint = commit.index("Call RepointShortcuts")
        self.assertLess(move, repoint)
        repointed = commit[:repoint].rsplit('${If} $MoveFrom != ""', 1)[1]
        self.assertIn('!insertmacro SameFolder "" "$INSTDIR" "$MoveTo" $0', repointed)
        self.assertIn('SetOutPath "$INSTDIR"', repointed)
        self.assertLess(repoint, commit.index("WriteRegStr"))
        self.assertEqual(commit.count("Call RepointShortcuts"), 1)
        last_write = max(match.start() for match in re.finditer(r'WriteReg\w+ SHCTX "\$\{UNINSTKEY\}"', commit))
        self.assertLess(last_write, commit.index("Call RemoveOldKeys"))

    def test_the_folder_is_renamed_never_copied_and_nothing_is_left_behind(self):
        move = block("Function", "MoveInstallFolder")
        self.assertLess(move.index('SetOutPath "$TEMP"'), move.index("Rename "))
        self.assertRegex(move, r'Rename "\$INSTDIR" "\$MoveTo"\n\s*IfErrors 0 move_renamed')
        # Only an empty folder in the way is removed; data is never deleted or copied.
        self.assertIn('RMDir "$MoveTo"', move)
        for forbidden in ("RMDir /r", "RmDir /r", "CopyFiles", "mklink", "CreateSymbolicLink", "Junction"):
            self.assertNotIn(forbidden, move)
        self.assertNotIn("CopyFiles", SOURCE)
        deletes = re.findall(r'(?m)^\s*Delete (.+)$', move)
        self.assertEqual(set(deletes), {'"$INSTDIR\\${MOVEDFROMFILE}"'})
        # The file for the app goes in before the rename, so that it moves with the files, and
        # comes out again when the folder stays.
        self.assertLess(move.index('FileOpen $0 "$INSTDIR\\${MOVEDFROMFILE}" w'), move.index("Rename "))
        self.assertLess(move.index("FileWriteWord $0 65279"), move.index("FileWriteUTF16LE"))
        failed = move.split('StrCpy $move_result "rename_failed"', 1)[1].split("Goto move_done", 1)[0]
        self.assertIn('Delete "$INSTDIR\\${MOVEDFROMFILE}"', failed)
        renamed = move.split("move_renamed:", 1)[1].split("Goto move_done", 1)[0]
        self.assertIn("StrCpy $INSTDIR $MoveTo", renamed)

    def test_the_old_keys_go_unless_they_record_another_install(self):
        remove = SOURCE.split("Function ${un}RemoveOldKeys\n", 1)[1].split("FunctionEnd", 1)[0]
        guard = remove.index('${AndIf} ${FileExists} "$0\\uninstall.exe"')
        self.assertLess(guard, remove.index('DeleteRegKey SHCTX "${OLDUNINSTKEY}"'))
        self.assertLess(guard, remove.index('DeleteRegKey SHCTX "${OLDMANUPRODUCTKEY}"'))
        uninstall = block("Section", "Uninstall")
        self.assertLess(uninstall.index('DeleteRegKey HKCU "${UNINSTKEY}"'), uninstall.index("Call un.RemoveOldKeys"))
        self.assertIn('Delete "$INSTDIR\\${MOVEDFROMFILE}"', uninstall)

    def test_only_shortcuts_that_are_there_are_pointed_at_the_new_place(self):
        macro = SOURCE.split("!macro RepointShortcut shortcut\n", 1)[1].split("!macroend", 1)[0]
        self.assertTrue(macro.strip().startswith('${If} ${FileExists} "${shortcut}"'))
        self.assertIn('CreateShortcut "${shortcut}" "$INSTDIR\\${MAINBINARYNAME}.exe"', macro)
        self.assertNotIn("Pin", block("Function", "RepointShortcuts"))

    def test_the_helpers_stop_under_both_names(self):
        macro = SOURCE.split("\n!macro CheckIfAppIsRunning\n", 1)[1].split("\n!macroend", 1)[0]
        after_app = macro.split("app_check_done:", 1)[1]
        for name in ("${OTHERBINARYNAME}.exe", "vrct-rvc-worker.exe", "astarot-rvc-worker.exe"):
            self.assertIn(f'!insertmacro StopLeftoverProcess "{name}"', after_app)


if __name__ == "__main__":
    unittest.main()
