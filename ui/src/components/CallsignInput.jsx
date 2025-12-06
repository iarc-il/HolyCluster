import Input from "@/components/Input.jsx";

function CallsignInput({ className, onChange, ...props }) {
    if (className == null) {
        className = "";
    }
    if (!className.includes("uppercase")) {
        className += " uppercase";
    }

    const handleChange = event => {
        const sanitized = event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        event.target.value = sanitized;
        if (onChange) {
            onChange(event);
        }
    };

    return <Input className={className} onChange={handleChange} {...props} />;
}

export default CallsignInput;
