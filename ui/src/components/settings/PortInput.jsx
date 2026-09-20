import Input from "@/components/ui/Input.jsx";

function PortInput({ error, show_error_message = true, id, className = "", ...props }) {
    const error_id = `${id}-error`;

    return (
        <>
            <Input
                {...props}
                id={id}
                type="number"
                min={props.min ?? 1}
                max={props.max ?? 65535}
                step={1}
                aria-invalid={Boolean(error)}
                aria-describedby={error && show_error_message ? error_id : undefined}
                className={className}
                style={
                    error
                        ? {
                              backgroundColor: "#fecaca",
                              borderColor: "#dc2626",
                              color: "#7f1d1d",
                          }
                        : undefined
                }
            />
            {error && show_error_message ? (
                <p id={error_id} className="mt-1 text-sm text-red-600" role="alert">
                    {error}
                </p>
            ) : null}
        </>
    );
}

export default PortInput;
