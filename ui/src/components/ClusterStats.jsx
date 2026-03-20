import { useState } from "react";

import Modal from "@/components/ui/Modal.jsx";
import Tabs from "@/components/ui/Tabs.jsx";
import Select from "@/components/ui/Select.jsx";
import { useColors } from "@/hooks/useColors.jsx";

function StatsIcon({ size }) {
    const { colors } = useColors();

    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <title>Cluster Statistics</title>
            <path
                d="M18 20V10M12 20V4M6 20V14"
                stroke={colors.buttons.utility}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

const HOURS_OPTIONS = [
    { label: "24h", value: 24 },
    { label: "48h", value: 48 },
    { label: "72h", value: 72 },
    { label: "7 days", value: 168 },
    { label: "All", value: "" },
];

function OverviewTable({ data, colors }) {
    const header_style = {
        padding: "8px 12px",
        textAlign: "left",
        borderBottom: `2px solid ${colors.theme.borders}`,
        fontWeight: "bold",
    };

    const cell_style = {
        padding: "8px 12px",
        borderBottom: `1px solid ${colors.theme.borders}`,
    };

    const sorted = [...data.clusters].sort((a, b) => b.total - a.total);

    return (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
                <tr>
                    <th style={header_style}>Cluster</th>
                    <th style={{ ...header_style, textAlign: "right" }}>Total</th>
                    <th style={{ ...header_style, textAlign: "right" }}>Exclusive</th>
                    <th style={{ ...header_style, textAlign: "right" }}>Exclusive %</th>
                    <th style={{ ...header_style, textAlign: "right" }}>Overlap</th>
                </tr>
            </thead>
            <tbody>
                {sorted.map(cluster => (
                    <tr key={cluster.name}>
                        <td style={cell_style}>{cluster.name}</td>
                        <td style={{ ...cell_style, textAlign: "right" }}>
                            {cluster.total.toLocaleString()}
                        </td>
                        <td style={{ ...cell_style, textAlign: "right" }}>
                            {cluster.exclusive.toLocaleString()}
                        </td>
                        <td style={{ ...cell_style, textAlign: "right" }}>
                            {cluster.exclusive_pct}%
                        </td>
                        <td style={{ ...cell_style, textAlign: "right" }}>
                            {cluster.overlap.toLocaleString()}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function PairwiseTable({ data, colors }) {
    const clusters = data.clusters.map(c => c.name).sort();
    const overlap = data.pairwise_overlap;
    const totals = Object.fromEntries(data.clusters.map(c => [c.name, c.total]));

    const max_pct = Math.max(
        1,
        ...clusters.flatMap(c1 =>
            clusters.map(c2 => {
                const value = (overlap[c1] && overlap[c1][c2]) || 0;
                return totals[c1] > 0 ? (value / totals[c1]) * 100 : 0;
            }),
        ),
    );

    const header_style = {
        padding: "6px 8px",
        textAlign: "center",
        borderBottom: `2px solid ${colors.theme.borders}`,
        fontWeight: "bold",
        fontSize: "12px",
    };

    const cell_style = {
        padding: "6px 8px",
        textAlign: "center",
        borderBottom: `1px solid ${colors.theme.borders}`,
        fontSize: "12px",
    };

    return (
        <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                    <tr>
                        <th style={header_style}></th>
                        {clusters.map(name => (
                            <th key={name} style={header_style}>
                                {name}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {clusters.map(row => (
                        <tr key={row}>
                            <td style={{ ...cell_style, fontWeight: "bold", textAlign: "left" }}>
                                {row}
                            </td>
                            {clusters.map(col => {
                                if (row === col) {
                                    return (
                                        <td
                                            key={col}
                                            style={{ ...cell_style, color: colors.theme.borders }}
                                        >
                                            -
                                        </td>
                                    );
                                }
                                const value = (overlap[row] && overlap[row][col]) || 0;
                                const pct = totals[row] > 0 ? (value / totals[row]) * 100 : 0;
                                const intensity = max_pct > 0 ? pct / max_pct : 0;
                                const bg = `rgba(59, 130, 246, ${intensity * 0.5})`;
                                return (
                                    <td key={col} style={{ ...cell_style, backgroundColor: bg }}>
                                        {pct > 0 ? `${pct.toFixed(1)}%` : "0%"}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ClusterStats() {
    const { colors } = useColors();
    const [data, set_data] = useState(null);
    const [loading, set_loading] = useState(false);
    const [error, set_error] = useState(null);
    const [hours, set_hours] = useState(24);

    async function fetch_stats(selected_hours) {
        set_loading(true);
        set_error(null);
        try {
            const url = selected_hours
                ? `/cluster_stats?hours=${selected_hours}`
                : "/cluster_stats";
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const json = await response.json();
            set_data(json);
        } catch (e) {
            set_error(e.message);
        } finally {
            set_loading(false);
        }
    }

    function on_open() {
        fetch_stats(hours);
    }

    function on_hours_change(event) {
        const value = event.target.value;
        const new_hours = value === "" ? "" : parseInt(value);
        set_hours(new_hours);
        fetch_stats(new_hours);
    }

    const content = loading ? (
        <div className="flex items-center justify-center p-8">Loading...</div>
    ) : error ? (
        <div className="flex items-center justify-center p-8 text-red-500">Error: {error}</div>
    ) : data ? (
        <Tabs
            tabs={[
                {
                    label: <span className="text-base">Overview</span>,
                    text_color: colors.theme.text,
                    content: (
                        <div className="max-h-[60vh] overflow-y-auto p-4">
                            <OverviewTable data={data} colors={colors} />
                        </div>
                    ),
                },
                {
                    label: <span className="text-base">Pairwise Overlap</span>,
                    text_color: colors.theme.text,
                    content: (
                        <div className="max-h-[60vh] overflow-auto p-4">
                            <PairwiseTable data={data} colors={colors} />
                        </div>
                    ),
                },
            ]}
        />
    ) : null;

    return (
        <Modal
            button={<StatsIcon size="36" />}
            on_open={on_open}
            on_cancel={() => true}
            cancel_text="Close"
        >
            <div className="text-left w-[40rem]" style={{ color: colors.theme.text }}>
                <div
                    className="flex items-center justify-between p-4 border-b"
                    style={{ borderColor: colors.theme.borders }}
                >
                    <span className="text-lg font-bold">Cluster Statistics</span>
                    <div className="flex items-center gap-3 px-6">
                        <span className="text-sm opacity-70">Period: </span>
                        <Select value={hours} onChange={on_hours_change} className="!w-24">
                            {HOURS_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>
                {content}
            </div>
        </Modal>
    );
}

export default ClusterStats;
