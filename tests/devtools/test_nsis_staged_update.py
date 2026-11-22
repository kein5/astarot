"""Source contracts for the Windows installer; real execution lives in installer/."""

import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "src-tauri/nsis/template.nsi").read_text(encoding="utf-8")


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
        self.assertRegex(before, r'Rename "\$TEMP\\\$file_name" "\$INSTDIR\\\.upd\\\$file_name"\n\s*IfErrors attempt_failed')
        # A failed SetOutPath must not let tar unpack into the old directory.
        self.assertRegex(before, r'SetOutPath "\$INSTDIR\\\.upd\\new"\n\s*\$\{IfNot\} \$\{Errors\}')
        # Leave the staging tree before retrying, committing or removing it.
        self.assertLess(after.index('SetOutPath "$TEMP"'), after.index("${If} $0 == 0"))
        # A retry must not trip over an archive that could not be moved back.
        attempt = install.split("install_attempt:", 1)[1].split("${If} $dl_parallel", 1)[0]
        self.assertIn('Delete "$INSTDIR\\.upd\\$file_name"', attempt)
        failed = after.split("attempt_failed:", 1)[0]
        self.assertIn('Rename "$INSTDIR\\.upd\\$file_name" "$TEMP\\$file_name"', failed)

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
        self.assertLess(hash_failed.index('Delete "$TEMP\\$file_name"'), hash_failed.index("Abort"))

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
        self.assertIn('Delete "$TEMP\\$file_name"', kept)
        self.assertLess(attempt.index("${EndIf}", attempt.index(kept)), attempt.index('StrCpy $dl_resume "0"'))
        self.assertIn('NScurl::http GET "$cmder_dl" "$TEMP\\$file_name" /INSIST /RESUME', install)

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
        self.assertLess(cleanup.index("Call StopPackageTransfers"), cleanup.index("Delete "))

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

    def test_delete_app_data_covers_state_next_to_config(self):
        uninstall = block("Section", "Uninstall")
        opted_in = uninstall.split("${If} $DeleteAppDataCheckboxState == 1", 1)[1].split("${EndIf}", 1)[0]
        for line in ('RmDir /r "$INSTDIR\\downloaded_models"', 'Delete "$INSTDIR\\voice_mute_state.json"',
                     'Delete "$INSTDIR\\config.json"', 'RmDir /r "$INSTDIR\\weights"',
                     # The registered models (#403), listed in docs/spec/data-and-persistence.md.
                     'Delete "$INSTDIR\\user_models.json"'):
            self.assertIn(line, opted_in)
            # Kept when the box is not ticked, e.g. when an update moves the install.
            self.assertEqual(uninstall.count(line), 1)



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
