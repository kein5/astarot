import { isNetworkDisconnected } from "./endpointPrivacy";
import { useNotificationStatus } from "@logics_common";
import { useI18n } from "@useI18n";

export const useHandleNetworkConnection = () => {
    const { t } = useI18n();
    const { showNotification_Error } = useNotificationStatus();

    // /run/connected_network: whether the network is reachable.
    const handleNetworkConnection = (is_network_connected: unknown) => {
        if (isNetworkDisconnected(is_network_connected)) {
            showNotification_Error(t("network_privacy.disconnected"), {
                hide_duration: 8000,
            });
        }
    };

    return {
        handleNetworkConnection,
    };
};
