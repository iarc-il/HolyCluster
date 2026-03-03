import { createContext, useContext, useEffect, useState } from "react";

const RestDataContext = createContext(undefined);

export function useRestData() {
    return useContext(RestDataContext);
}

export const RestDataProvider = ({ children }) => {
    const [propagation, set_propagation] = useState();
    const [dxpeditions, set_dxpeditions] = useState([]);

    useEffect(() => {
        const fetch_propagation = () => {
            if (!navigator.onLine) return;

            fetch("/propagation")
                .then(response => (response.ok ? response.json() : Promise.reject(response)))
                .then(data => data && set_propagation(data))
                .catch(() => {});
        };

        fetch_propagation();
        const interval_id = setInterval(fetch_propagation, 3600 * 1000);
        return () => clearInterval(interval_id);
    }, []);

    useEffect(() => {
        const fetch_dxpeditions = () => {
            if (!navigator.onLine) return;

            fetch("/dxpeditions")
                .then(response => (response.ok ? response.json() : Promise.reject(response)))
                .then(
                    data => data && set_dxpeditions(data.map((item, id) => ({ id: id, ...item }))),
                )
                .catch(() => {});
        };

        fetch_dxpeditions();
        const interval_id = setInterval(fetch_dxpeditions, 3600 * 1000);
        return () => clearInterval(interval_id);
    }, []);

    return (
        <RestDataContext.Provider value={{ propagation, dxpeditions }}>
            {children}
        </RestDataContext.Provider>
    );
};
