import React, { useState } from "react";
import ToggleSwitchOff from "@/components/ui/ToggleSwitchOff";
import ToggleSwitchOn from "@/components/ui/ToggleSwitchOn";

const ToggleSVG = ({ auto_radius, set_auto_radius }) => {
    return (
        <button onClick={() => set_auto_radius(!auto_radius)} title="Toggle Auto Radius">
            {auto_radius ? <ToggleSwitchOn /> : <ToggleSwitchOff />}
        </button>
    );
};

export default ToggleSVG;
