export function format_bytes(bytes) {
    const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = size === 0 ? 0 : Math.min(units.length - 1, Math.floor(Math.log10(size) / 3));
    const unit_index = Math.max(0, index);
    const value = size / 1000 ** unit_index;
    return `${unit_index === 0 ? Math.round(value) : Number(value.toFixed(1))} ${units[unit_index]}`;
}
