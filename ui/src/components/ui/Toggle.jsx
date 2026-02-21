import React, { useState } from "react";

function Toggle({ value, on_click }) {
    const color_class = value ? "bg-green-500" : "bg-gray-300";
    const position_class = value ? "translate-x-6" : "translate-x-0";

    return (
        <div
            className={`w-12 h-6 flex items-center px-1 rounded-full cursor-pointer ${color_class}`}
            onClick={on_click}
        >
            <div
                className={`w-4 h-4 bg-white rounded-full shadow-md transform ${position_class}`}
            />
        </div>
    );
}

export default Toggle;
