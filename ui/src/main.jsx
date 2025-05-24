import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";

import MainContainer from "@/components/MainContainer.jsx";
import Addons from "@/components/addons/Addons";
import { ServerDataProvider } from "@/hooks/useServerData";
import { FiltersProvider } from "@/hooks/useFilters";
import { ColorsProvider } from "@/hooks/useColors";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter>
            <Routes>
                <Route
                    path="/"
                    element={
                        <ColorsProvider>
                            <FiltersProvider>
                                <ServerDataProvider>
                                    <MainContainer />
                                </ServerDataProvider>
                            </FiltersProvider>
                        </ColorsProvider>
                    }
                />
                <Route path="/addons" element={<Addons />} />
            </Routes>
        </BrowserRouter>
    </React.StrictMode>,
);
