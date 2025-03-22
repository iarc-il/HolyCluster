import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect, useState } from "react";

function Tabs({ tabs, local_storage_name = null, external_tab = null }) {
    const [active_tab, set_active_tab] = useLocalStorage(local_storage_name, 0);

    useEffect(() => {
        if (local_storage_name == null) {
            set_active_tab(0);
        }
    }, []);

    useEffect(() => {
        if (external_tab != null) {
            set_active_tab(external_tab);
        }
    }, [external_tab]);

    return (
        <div className="h-full w-full">
            <div className="flex border-b">
                {tabs.map((tab, index) => (
                    <button
                        key={index}
                        className={`flex-1 text-center text-gray-800 py-2 text-sm font-medium ${tab.bg} ${
                            active_tab === index ? "border-b-2 border-gray-800" : "border-gray-500"
                        }`}
                        onClick={() => set_active_tab(index)}
                    >
                        <div
                            className="inline-flex items-center justify-center"
                            style={{ color: tab.text_color }}
                        >
                            {tab.icon != null ? (
                                <svg
                                    width="16"
                                    height="16"
                                    fill="currentColor"
                                    className="bi bi-globe"
                                    viewBox="0 0 16 16"
                                >
                                    <path d={tab.icon} />
                                </svg>
                            ) : (
                                ""
                            )}
                            &nbsp;{tab.label}
                        </div>
                    </button>
                ))}
            </div>

            <div className="w-full h-[calc(100%-42px)]">{tabs[active_tab].content}</div>
        </div>
    );
}

export default Tabs;
