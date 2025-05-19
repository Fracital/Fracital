import { XOR } from "../libs/XOR";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const ExternalSite = () => {
    const location = useLocation();
    const state = location.state as { q: string } | null;
    const query = state?.q || "";

    const [url, setUrl] = useState("");

    useEffect(() => {
        if (query) {
            setUrl(localStorage.getItem("proxy") === "sj" ? "/service/" + XOR.encode(query) : "/uv/service/" + XOR.encode(query));
        }
    }, [query]);

    return (
        <iframe className="w-full h-full" src={url}></iframe>
    );
}

export default ExternalSite;