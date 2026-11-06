import Button from "@/components/ui/Button";
import { useColors } from "@/hooks/useColors";
import { useUpdate } from "@/hooks/useUpdate.jsx";

function UnsupportedVersion() {
    const { colors } = useColors();
    const { enabled, install } = useUpdate();

    return (
        <div
            className="text-sm h-full overflow-x-visible border-x-4"
            style={{
                borderColor: colors.theme.borders,
                backgroundColor: colors.theme.background,
                color: colors.theme.text,
            }}
        >
            <div className="flex flex-col items-center justify-center h-full space-y-4 p-4">
                <div className="text-xl font-medium text-red-600">CAT Control update required</div>
                <div className="text-center">
                    Update CAT Control to continue using the spots table.
                </div>
                {enabled ? (
                    <Button className="px-4 py-2" on_click={install}>
                        Update now
                    </Button>
                ) : (
                    <a
                        className="px-4 py-2 font-medium rounded-lg bg-blue-600 text-white"
                        href="/addons#download"
                    >
                        Download update
                    </a>
                )}
            </div>
        </div>
    );
}

export default UnsupportedVersion;
