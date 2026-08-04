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
import { RotatorProvider } from "@/hooks/useRotator";
import { SettingsProvider } from "@/hooks/useSettings";
import { SpotInteractionProvider } from "@/hooks/useSpotInteraction";
import { UpdateProvider } from "@/hooks/useUpdate";
import { WsProvider } from "@/hooks/useWs";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter>
            <WsProvider>
                <ProfilesProvider>
                    <Routes>
                        <Route
                            path="/"
                            element={
                                <ColorsProvider>
                                    <FiltersProvider>
                                        <SettingsProvider>
                                            <UpdateProvider>
                                                <RadioProvider>
                                                    <RotatorProvider>
                                                        <SpotInteractionProvider>
                                                            <MainContainer />
                                                        </SpotInteractionProvider>
                                                    </RotatorProvider>
                                                </RadioProvider>
                                            </UpdateProvider>
                                        </SettingsProvider>
                                    </FiltersProvider>
                                </ColorsProvider>
                            }
                        />
                        <Route
                            path="/addons"
                            element={
                                <SettingsProvider>
                                    <UpdateProvider>
                                        <RadioProvider>
                                            <Addons />
                                        </RadioProvider>
                                    </UpdateProvider>
                                </SettingsProvider>
                            }
                        />
                        <Route path="/omnirig-error" element={<OmniRigError />} />
                    </Routes>
                </ProfilesProvider>
            </WsProvider>
        </BrowserRouter>
    </React.StrictMode>,
);
