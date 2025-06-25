const Hexagon = ({ handleClick, dx_x, dx_size, dx_y, color }) => {
    return (
        <polygon
            points={`
        ${dx_x + (dx_size / 1.6) * Math.cos(0)},${dx_y + (dx_size / 1.6) * Math.sin(0)}
        ${dx_x + (dx_size / 1.6) * Math.cos(Math.PI / 3)},${dx_y + (dx_size / 1.6) * Math.sin(Math.PI / 3)}
        ${dx_x + (dx_size / 1.6) * Math.cos((2 * Math.PI) / 3)},${dx_y + (dx_size / 1.6) * Math.sin((2 * Math.PI) / 3)}
        ${dx_x + (dx_size / 1.6) * Math.cos(Math.PI)},${dx_y + (dx_size / 1.6) * Math.sin(Math.PI)}
        ${dx_x + (dx_size / 1.6) * Math.cos((4 * Math.PI) / 3)},${dx_y + (dx_size / 1.6) * Math.sin((4 * Math.PI) / 3)}
        ${dx_x + (dx_size / 1.6) * Math.cos((5 * Math.PI) / 3)},${dx_y + (dx_size / 1.6) * Math.sin((5 * Math.PI) / 3)}
    `}
            fill={color}
            stroke="grey"
            strokeWidth="1px"
            onClick={() => handleClick()}
        />
    );
};

export default Hexagon;
