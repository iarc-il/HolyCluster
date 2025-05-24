export default function Card({ className, children }) {
    return (
        <div className={`rounded-lg border bg-card text-card-foreground shadow-sm ${className}`}>
            {children}
        </div>
    );
}
