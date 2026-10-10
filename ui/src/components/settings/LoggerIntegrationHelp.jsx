import aclogIntegrationImage from "@/assets/aclog_integration.png";
import aclogMenuImage from "@/assets/aclog_menu.png";
import log4omImage from "@/assets/log4om_integration.png";
import HelpIcon from "@/components/ui/HelpIcon.jsx";
import Modal from "@/components/ui/Modal.jsx";
import Tabs from "@/components/ui/Tabs.jsx";

function LoggerIntegrationHelp({ colors }) {
    return (
        <Modal
            title={
                <h3 className="text-2xl" style={{ color: colors.theme.text }}>
                    Logger Integration Guide
                </h3>
            }
            button={<HelpIcon size="20" />}
            data_tour="settings-cat-log4om-help"
            dialog_data_tour="settings-cat-log4om-modal"
        >
            <div className="w-[min(80rem,calc(100vw-4rem))]">
                <Tabs
                    local_storage_name="logger-integration-help-tab"
                    tabs={[
                        {
                            label: "Log4OM",
                            text_color: colors.theme.text,
                            content: (
                                <div className="max-h-[60vh] overflow-y-auto p-4">
                                    <p>
                                        When clicking on a callsign, the CAT server can notify
                                        Log4OM and autofill the callsign field.
                                    </p>
                                    <p>To configure this feature, follow this guide:</p>
                                    <img
                                        src={log4omImage}
                                        alt="Log4OM integration guide"
                                        className="max-w-full h-auto mx-auto"
                                    />
                                </div>
                            ),
                        },
                        {
                            label: "ACLog",
                            text_color: colors.theme.text,
                            content: (
                                <div className="max-h-[60vh] overflow-y-auto p-4">
                                    <p>To configure ACLog integration, Open the API settings:</p>
                                    <img
                                        src={aclogMenuImage}
                                        alt="ACLog integration guide"
                                        className="max-w-full h-auto mx-auto"
                                    />
                                    <p>And then enable incoming reports:</p>
                                    <img
                                        src={aclogIntegrationImage}
                                        alt="ACLog integration guide"
                                        className="max-w-full h-auto mx-auto"
                                    />
                                </div>
                            ),
                        },
                    ]}
                />
            </div>
        </Modal>
    );
}

export default LoggerIntegrationHelp;
