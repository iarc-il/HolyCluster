import { useEffect, useState } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";

import Modal from "@/components/Modal.jsx";
import Tabs from "@/components/Tabs.jsx";
import { useColors } from "../hooks/useColors";

const RELEASES = [
    [
        "04/04/2025",
        [
            "The band bar",
            "Toggle alerts",
            "Zulu to UTC",
            "CAT control infrastructure",
            "New tutorial video by VE9CF",
        ],
    ],
    [
        "10/03/2025",
        ["New callsign filter interface supporting filtering by dx/spotter and dxcc entity"],
    ],
    [
        "25/01/2025",
        [
            "Dark mode (In settings menu)",
            "Change distance units to miles (In settings menu)",
            "Sort the spots table by clicking on a column name",
            "Submit a new spot",
            "Propagation data",
            "Map center indicator",
            "Small bug fixes",
        ],
    ],
    ["24/12/2024", ["Initial release"]],
];

function Info({ size }) {
    const { colors } = useColors();

    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <title>About us!</title>
            <path
                d="M12 9H12.01M3 12C3 13.1819 3.23279 14.3522 3.68508 15.4442C4.13738 16.5361 4.80031 17.5282 5.63604 18.364C6.47177 19.1997 7.46392 19.8626 8.55585 20.3149C9.64778 20.7672 10.8181 21 12 21C13.1819 21 14.3522 20.7672 15.4442 20.3149C16.5361 19.8626 17.5282 19.1997 18.364 18.364C19.1997 17.5282 19.8626 16.5361 20.3149 15.4442C20.7672 14.3522 21 13.1819 21 12C21 9.61305 20.0518 7.32387 18.364 5.63604C16.6761 3.94821 14.3869 3 12 3C9.61305 3 7.32387 3.94821 5.63604 5.63604C3.94821 7.32387 3 9.61305 3 12Z"
                stroke={colors.buttons.utility}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M11 12H12V16H13"
                stroke={colors.buttons.utility}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function About() {
    const { colors } = useColors();

    const about = (
        <div className="p-2">
            <p>
                The Holy Cluster is being developed by a group of Israeli amateur radio enthusiasts,
                <br />
                with the support of the Israeli Association of Radio Communication ({}
                <a
                    className="text-blue-500 underline"
                    href="https://www.iarc.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    IARC
                </a>
                ).
                <br />
                <br />
                We hope this platform will serve as a valuable tool for radio operators worldwide,
                <br />
                fostering collaboration and enhancing the global radio communication experience.
                <br />
            </p>
            <br />
            <p>
                You can find a nice tutorial by Stuart (VE9CF) on youtube{" "}
                <a href="https://youtu.be/GFeqUilCaVI?si=W4C8jZ9-zQNsp3y3" target="_blank">
                    <svg
                        width="64px"
                        height="64px"
                        viewBox="0 -0.5 25 25"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        stroke="#ff0000"
                    >
                        <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
                        <g
                            id="SVGRepo_tracerCarrier"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        ></g>
                        <g id="SVGRepo_iconCarrier">
                            {" "}
                            <path
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="M18.168 19.0028C20.4724 19.0867 22.41 17.29 22.5 14.9858V9.01982C22.41 6.71569 20.4724 4.91893 18.168 5.00282H6.832C4.52763 4.91893 2.58998 6.71569 2.5 9.01982V14.9858C2.58998 17.29 4.52763 19.0867 6.832 19.0028H18.168Z"
                                stroke="#ff0000"
                                stroke-width="1.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            ></path>{" "}
                            <path
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="M12.008 9.17784L15.169 11.3258C15.3738 11.4454 15.4997 11.6647 15.4997 11.9018C15.4997 12.139 15.3738 12.3583 15.169 12.4778L12.008 14.8278C11.408 15.2348 10.5 14.8878 10.5 14.2518V9.75184C10.5 9.11884 11.409 8.77084 12.008 9.17784Z"
                                stroke="#ff0000"
                                stroke-width="1.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            ></path>{" "}
                        </g>
                    </svg>
                </a>
            </p>
            Contact us at: <strong>holycluster@iarc.org</strong>
        </div>
    );

    const [last_release, set_last_release] = useLocalStorage("last_release", "");
    const [should_display_release_notes, set_should_display_release_notes] = useState(false);

    useEffect(() => {
        if (last_release != RELEASES[0][0]) {
            set_should_display_release_notes(true);
            set_last_release(RELEASES[0][0]);
        }
    }, [last_release]);

    const release_notes = (
        <div className="p-2">
            {RELEASES.map(([date, changes]) => {
                return (
                    <p className="pb-4" key={date}>
                        <h1 className="text-xl font-bold">{date}</h1>
                        <ul className="list-disc pl-4">
                            {changes.map((change, index) => (
                                <li key={index}>{change}</li>
                            ))}
                        </ul>
                    </p>
                );
            })}
        </div>
    );

    return (
        <Modal
            button={<Info size="36"></Info>}
            on_cancel={() => true}
            cancel_text="close"
            external_open={should_display_release_notes}
        >
            <div className="text-left w-full" style={{ color: colors.theme.text }}>
                <Tabs
                    tabs={[
                        {
                            label: <h1 className="text-xl">About</h1>,
                            text_color: colors.theme.text,
                            content: about,
                        },
                        {
                            label: <h1 className="text-xl">Release Notes</h1>,
                            text_color: colors.theme.text,
                            content: release_notes,
                        },
                    ]}
                    external_tab={should_display_release_notes ? 1 : null}
                ></Tabs>
            </div>
        </Modal>
    );
}

export default About;
