import React, { useState } from "react";
import ToggleSwitchOff from "@/assets/ToggleSwitchOff";
import ToggleSwitchOn from "@/assets/ToggleSwitchOn";

const ToggleSVG = ({ set_auto_toggle_radius }) => {
  console.log("toggle set_auto_toggle_radius", set_auto_toggle_radius);
  const [enabled, setEnabled] = useState(false);
  set_auto_toggle_radius(enabled);

  return (
    <button
      onClick={() => setEnabled(!enabled)}
      // className="p-1 bg-gray-300 rounded hover:bg-gray-400"
      title="Toggle something"
    >
      {enabled ? <ToggleSwitchOn /> : <ToggleSwitchOff />}
    </button>
  );
};

export default ToggleSVG;
