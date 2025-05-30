interface ErrorProps {
    error: "no-site" | "no-proxy" | "no-uv" | "no-sj" | "no-sw";
}

const Error: React.FC<ErrorProps> = ({ error }) => {
    return (
        <div>
        </div>
    )
}

export default Error;