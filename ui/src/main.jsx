import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";

import MainContainer from "@/components/MainContainer.jsx";
import OmniRigError from "@/components/OmniRigError.jsx";
import Addons from "@/components/addons/Addons";
import { ColorsProvider } from "@/hooks/useColors";
import { FiltersProvider } from "@/hooks/useFilters";
import { ProfilesProvider } from "@/hooks/useProfiles";
import { RadioProvider } from "@/hooks/useRadio";
import { SettingsProvider } from "@/hooks/useSettings";
import { SpotInteractionProvider } from "@/hooks/useSpotInteraction";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter>
            <ProfilesProvider>
                <Routes>
                    <Route
                        path="/"
                        element={
                            <ColorsProvider>
                                <FiltersProvider>
                                    <SettingsProvider>
                                        <RadioProvider>
                                            <SpotInteractionProvider>
                                                <MainContainer />
                                            </SpotInteractionProvider>
                                        </RadioProvider>
                                    </SettingsProvider>
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
            </ProfilesProvider>
        </BrowserRouter>
    </React.StrictMode>,
);
