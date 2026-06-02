use axum::extract::ws::Message as AxumMessage;
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as TungsteniteCloseCode;

fn sanitize_tungstenite_close_code(
    close_code: TungsteniteCloseCode,
    direction: &str,
) -> TungsteniteCloseCode {
    if close_code.is_allowed() {
        return close_code;
    }

    tracing::warn!(
        close_code = u16::from(close_code),
        direction,
        "Replacing invalid WebSocket close code"
    );
    TungsteniteCloseCode::Error
}

fn tungstenite_to_axum_close_code(close_code: TungsteniteCloseCode) -> u16 {
    sanitize_tungstenite_close_code(close_code, "upstream-to-client").into()
}

pub fn tungstenite_to_axum_message(tungstenite_message: TungsteniteMessage) -> Option<AxumMessage> {
    match tungstenite_message {
        TungsteniteMessage::Text(text) => {
            let text: &str = text.as_ref();
            Some(AxumMessage::Text(axum::extract::ws::Utf8Bytes::from(text)))
        }
        TungsteniteMessage::Binary(bytes) => Some(AxumMessage::Binary(bytes)),
        TungsteniteMessage::Ping(bytes) => Some(AxumMessage::Ping(bytes)),
        TungsteniteMessage::Pong(bytes) => Some(AxumMessage::Pong(bytes)),
        TungsteniteMessage::Close(close_frame) => {
            Some(AxumMessage::Close(close_frame.map(|close_frame| {
                let reason: &str = close_frame.reason.as_ref();
                let reason = axum::extract::ws::Utf8Bytes::from(reason);
                axum::extract::ws::CloseFrame {
                    code: tungstenite_to_axum_close_code(close_frame.code),
                    reason,
                }
            })))
        }
        TungsteniteMessage::Frame(_frame) => {
            tracing::debug!("Ignoring raw upstream WebSocket frame");
            None
        }
    }
}

fn axum_to_tungstenite_close_code(close_code: u16) -> TungsteniteCloseCode {
    sanitize_tungstenite_close_code(TungsteniteCloseCode::from(close_code), "client-to-upstream")
}

pub fn axum_to_tungstenite_message(axum_message: AxumMessage) -> TungsteniteMessage {
    match axum_message {
        AxumMessage::Text(text) => {
            let text: &str = text.as_ref();
            TungsteniteMessage::Text(tokio_tungstenite::tungstenite::Utf8Bytes::from(text))
        }
        AxumMessage::Binary(bytes) => TungsteniteMessage::Binary(bytes),
        AxumMessage::Ping(bytes) => TungsteniteMessage::Ping(bytes),
        AxumMessage::Pong(bytes) => TungsteniteMessage::Pong(bytes),
        AxumMessage::Close(close_frame) => {
            TungsteniteMessage::Close(close_frame.map(|close_frame| {
                let reason: &str = close_frame.reason.as_ref();
                let reason = tokio_tungstenite::tungstenite::Utf8Bytes::from(reason);
                tokio_tungstenite::tungstenite::protocol::CloseFrame {
                    code: axum_to_tungstenite_close_code(close_frame.code),
                    reason,
                }
            }))
        }
    }
}
