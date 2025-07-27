import { useState, useEffect } from "react";
import { get_base_url } from "@/utils.js";
import About from "@/components/About.jsx";
import { useColors } from "@/hooks/useColors";
import use_radio from "@/hooks/useRadio";

function FeedbackButton({ size }) {
    const { colors } = useColors();

    return (
        <div>
            <a href="https://forms.gle/jak7KnvwCnBRN6QU7" target="_blank">
                <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
                    <title>Feedback form</title>
                    <path
                        d="M8 9H16M8 13H14M18 4C18.7956 4 19.5587 4.31607 20.1213 4.87868C20.6839 5.44129 21 6.20435 21 7V15C21 15.7956 20.6839 16.5587 20.1213 17.1213C19.5587 17.6839 18.7956 18 18 18H13L8 21V18H6C5.20435 18 4.44129 17.6839 3.87868 17.1213C3.31607 16.5587 3 15.7956 3 15V7C3 6.20435 3.31607 5.44129 3.87868 4.87868C4.44129 4.31607 5.20435 4 6 4H18Z"
                        stroke={colors.buttons.utility}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </a>{" "}
        </div>
    );
}

function CatserverDownload({ size, new_version_available }) {
    const { colors } = useColors();

    return (
        <div>
            <a href="/addons" target="_blank">
                {new_version_available ? (
                    <span className="absolute left-12 flex w-5 -translate-y-1 translate-x-1 z-10">
                        <span className="relative inline-flex border border-gray-900 bg-orange-600 text-white font-medium justify-center items-center rounded-full h-5 w-5 text-center text-[12px]">
                            !
                        </span>
                    </span>
                ) : (
                    ""
                )}
                <strong className="text-lg" style={{ color: colors.buttons.utility }}>
                    CAT
                </strong>
            </a>{" "}
        </div>
    );
}

function UtilityButtons() {
    const [new_version_available, set_new_version_available] = useState(false);
    const { catserver_version } = use_radio();

    useEffect(() => {
        if (catserver_version == null) {
            return;
        }
        fetch(get_base_url() + "/catserver/latest")
            .then(data => data.text())
            .then(data => {
                const remote_version = data.slice(0, data.lastIndexOf("."));
                console.log(
                    `Remote version: ${remote_version}, Local version: ${catserver_version}`,
                );
                if (catserver_version != remote_version) {
                    set_new_version_available(true);
                }
            });
    }, [catserver_version]);

    return (
        <div className="space-y-3">
            <CatserverDownload size="36" new_version_available={new_version_available} />
            <FeedbackButton size="36" />
            <About version={catserver_version} />
        </div>
    );
}

export default UtilityButtons;
