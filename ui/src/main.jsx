import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";

import MainContainer from "@/components/MainContainer.jsx";
import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";
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
import { initializeSentry } from "@/sentry";

const Addons = lazy(() => import("@/components/addons/Addons"));
const OmniRigError = lazy(() => import("@/components/OmniRigError.jsx"));

initializeSentry();

const container = document.getElementById("root");
const root = import.meta.hot?.data.root ?? ReactDOM.createRoot(container);

if (import.meta.hot) {
    import.meta.hot.data.root = root;
}

root.render(
    <React.StrictMode>
        <RouteErrorBoundary>
            <BrowserRouter>
                <WsProvider>
                    <ProfilesProvider>
                        <Suspense fallback={null}>
                            <Routes>
                                <Route
                                    path="/"
                                    element={
                                        <ColorsProvider>
                                            <FiltersProvider>
                                                <SettingsProvider>
                                                    <RadioProvider>
                                                        <UpdateProvider>
                                                            <RotatorProvider>
                                                                <SpotInteractionProvider>
                                                                    <MainContainer />
                                                                </SpotInteractionProvider>
                                                            </RotatorProvider>
                                                        </UpdateProvider>
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
                                            <Addons />
                                        </SettingsProvider>
                                    }
                                />
                                <Route path="/omnirig-error" element={<OmniRigError />} />
                            </Routes>
                        </Suspense>
                    </ProfilesProvider>
                </WsProvider>
            </BrowserRouter>
        </RouteErrorBoundary>
    </React.StrictMode>,
);
