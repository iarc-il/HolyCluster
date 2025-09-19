import { useState, useEffect } from "react";
import useRadio from "./useRadio.jsx";
import { get_base_url } from "../utils";

export function useCatserverVersion() {
    const { catserver_version } = useRadio();
    const [remote_version, set_remote_version] = useState(null);
    const [new_version_available, set_new_version_available] = useState(false);
    const [filename, set_filename] = useState("");

    useEffect(() => {
        if (catserver_version == null) {
            return;
        }

        fetch(get_base_url() + "/catserver/latest")
            .then(data => data.text())
            .then(data => {
                set_filename(data);
                const remote_ver = data.slice(0, data.lastIndexOf("."));
                set_remote_version(remote_ver);

                if (catserver_version !== remote_ver) {
                    set_new_version_available(true);
                    console.log(
                        `New version available - Remote: ${remote_ver}, Local: ${catserver_version}`,
                    );
                }
            });
    }, [catserver_version]);

    return {
        local_version: catserver_version,
        remote_version,
        new_version_available,
        filename,
    };
}
