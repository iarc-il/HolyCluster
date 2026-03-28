import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";

import MainContainer from "@/components/MainContainer.jsx";
import Addons from "@/components/addons/Addons";
import OmniRigError from "@/components/OmniRigError.jsx";
import { SpotDataProvider } from "@/hooks/useSpotData";
import { SpotInteractionProvider } from "@/hooks/useSpotInteraction";
import { RestDataProvider } from "@/hooks/useRestData";
import { FiltersProvider } from "@/hooks/useFilters";
import { ColorsProvider } from "@/hooks/useColors";
import { RadioProvider } from "@/hooks/useRadio";
import { SettingsProvider } from "@/hooks/useSettings";
import { DxccProvider } from "@/hooks/useDxcc";
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
                                <DxccProvider>
                                    <SettingsProvider>
                                        <RadioProvider>
                                            <RestDataProvider>
                                                <SpotInteractionProvider>
                                                    <SpotDataProvider>
                                                        <MainContainer />
                                                    </SpotDataProvider>
                                                </SpotInteractionProvider>
                                            </RestDataProvider>
                                        </RadioProvider>
                                    </SettingsProvider>
                                </DxccProvider>
                            </FiltersProvider>
                        </ColorsProvider>
                    }
                />
                <Route
                    path="/addons"
                    element={
                        <SettingsProvider>
                            <RadioProvider>
                                <Addons />
                            </RadioProvider>
                        </SettingsProvider>
                    }
                />
                <Route path="/omnirig-error" element={<OmniRigError />} />
            </Routes>
        </BrowserRouter>
    </React.StrictMode>,
);
