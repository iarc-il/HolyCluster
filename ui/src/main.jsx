import React from "react";
import ReactDOM from "react-dom/client";

import MainContainer from "@/components/MainContainer.jsx";
import { ServerDataProvider } from "@/hooks/useServerData";
import { FiltersProvider } from "@/hooks/useFilters";
import { ColorsProvider } from "@/hooks/useColors";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    <ColorsProvider>
        <FiltersProvider>
            <ServerDataProvider>
                <React.StrictMode>
                    <MainContainer />
                </React.StrictMode>
            </ServerDataProvider>
        </FiltersProvider>
    </ColorsProvider>,
);
