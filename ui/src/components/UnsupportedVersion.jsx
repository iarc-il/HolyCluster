import { useColors } from "@/hooks/useColors";
import Button from "@/components/Button";

function UnsupportedVersion() {
    const { colors } = useColors();

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
                <div className="text-xl font-medium text-red-600">
                    Unsupported CAT Control Version
                </div>
                <div className="text-center">
                    The version of CAT Control you are using is no longer supported. Please upgrade
                    to the latest version.
                </div>
                <Button
                    className="px-4 py-2"
                    on_click={() => {
                        window.location.href = "/catserver/download";
                    }}
                >
                    Upgrade Now
                </Button>
            </div>
        </div>
    );
}

export default UnsupportedVersion;
