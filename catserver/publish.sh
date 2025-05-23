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
                LOCAL_MSI_PATH="$2"
                ;;
            --remote-msi-dir)
                REMOTE_MSI_DIR="$2"
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

    MSI_NAME=$(git describe --match 'catserver-v*').msi

    echo Copying msi $MSI_NAME
    scp $LOCAL_MSI_PATH $DEPLOY_USER@$DEPLOY_HOST:$REMOTE_MSI_DIR/$MSI_NAME
    echo Updating latest version
    ssh $DEPLOY_USER@$DEPLOY_HOST "echo $MSI_NAME > $REMOTE_MSI_DIR/latest"
}

main $@
