#/bin/bash

set -e

main() {
    while [ $# -gt 0 ]; do
        case $1 in
            --deploy-user)
              DEPLOY_USER="$2"
              ;;
            --deploy-host)
                DEPLOY_HOST="$2"
                ;;
            --local-msi-path)
                LOCAL_ARTIFACT_PATH="$2"
                ;;
            --remote-msi-dir)
                REMOTE_ARTIFACT_DIR="$2"
                ;;
            --local-artifact-path)
                LOCAL_ARTIFACT_PATH="$2"
                ;;
            --remote-artifact-dir)
                REMOTE_ARTIFACT_DIR="$2"
                ;;
            --artifact-name)
                ARTIFACT_NAME="$2"
                ;;
            --latest-file)
                LATEST_FILE="$2"
                ;;
            *)
                echo Unknown arg: $1
                exit1
              ;;
        esac
        shift
        shift
    done

    chown -R $(id -u):$(id -g) .

    ARTIFACT_NAME=${ARTIFACT_NAME:-$(git describe --match 'catserver-v*').msi}
    LATEST_FILE=${LATEST_FILE:-latest}

    echo Copying artifact $ARTIFACT_NAME
    scp "$LOCAL_ARTIFACT_PATH" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_ARTIFACT_DIR/$ARTIFACT_NAME"
    echo Updating latest version
    ssh "$DEPLOY_USER@$DEPLOY_HOST" "echo $ARTIFACT_NAME > $REMOTE_ARTIFACT_DIR/$LATEST_FILE"
}

main $@
