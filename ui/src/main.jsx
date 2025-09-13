import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";

import MainContainer from "@/components/MainContainer.jsx";
import Addons from "@/components/addons/Addons";
import OmniRigError from "@/components/OmniRigError.jsx";
import { ServerDataProvider } from "@/hooks/useServerData";
import { FiltersProvider } from "@/hooks/useFilters";
import { ColorsProvider } from "@/hooks/useColors";
import { RadioProvider } from "@/hooks/useRadio";
import { SettingsProvider } from "@/hooks/useSettings";
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
                                <RadioProvider>
                                    <SettingsProvider>
                                        <ServerDataProvider>
                                            <MainContainer />
                                        </ServerDataProvider>
                                    </SettingsProvider>
                                </RadioProvider>
                            </FiltersProvider>
                        </ColorsProvider>
                    }
                />
                <Route path="/addons" element={<Addons />} />
                <Route path="/omnirig-error" element={<OmniRigError />} />
            </Routes>
        </BrowserRouter>
    </React.StrictMode>,
);
