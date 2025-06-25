const Triangle = ({ handleClick, dx_x, dx_size, dx_y, color }) => {
    return (
        <polygon
            points={`
        ${dx_x}, ${dx_y - dx_size / 2}
        ${dx_x - dx_size / 2}, ${dx_y + dx_size / 2}
        ${dx_x + dx_size / 2}, ${dx_y + dx_size / 2}
    `}
            fill={color}
            stroke="grey"
            strokeWidth="1px"
            onClick={() => handleClick()}
        />
    );
};

export default Triangle;
