use axum::extract::ws::Message as AxumMessage;
use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode as TungsteniteCloseCode;

fn tungstenite_to_axum_close_code(close_code: TungsteniteCloseCode) -> u16 {
    use axum::extract::ws::close_code::*;
    match close_code {
        TungsteniteCloseCode::Normal => NORMAL,
        TungsteniteCloseCode::Away => AWAY,
        TungsteniteCloseCode::Protocol => PROTOCOL,
        TungsteniteCloseCode::Unsupported => UNSUPPORTED,
        TungsteniteCloseCode::Status => STATUS,
        TungsteniteCloseCode::Abnormal => ABNORMAL,
        TungsteniteCloseCode::Invalid => INVALID,
        TungsteniteCloseCode::Policy => POLICY,
        TungsteniteCloseCode::Size => SIZE,
        TungsteniteCloseCode::Extension => EXTENSION,
        TungsteniteCloseCode::Error => ERROR,
        TungsteniteCloseCode::Restart => RESTART,
        TungsteniteCloseCode::Again => AGAIN,
        _ => todo!(),
    }
}

pub fn tungstenite_to_axum_message(tungstenite_message: TungsteniteMessage) -> AxumMessage {
    match tungstenite_message {
        TungsteniteMessage::Text(text) => {
            let text: &str = text.as_ref();
            AxumMessage::Text(axum::extract::ws::Utf8Bytes::from(text))
        }
        TungsteniteMessage::Binary(bytes) => AxumMessage::Binary(bytes),
        TungsteniteMessage::Ping(bytes) => AxumMessage::Ping(bytes),
        TungsteniteMessage::Pong(bytes) => AxumMessage::Pong(bytes),
        TungsteniteMessage::Close(close_frame) => {
            AxumMessage::Close(close_frame.map(|close_frame| {
                let reason: &str = close_frame.reason.as_ref();
                let reason = axum::extract::ws::Utf8Bytes::from(reason);
                axum::extract::ws::CloseFrame {
                    code: tungstenite_to_axum_close_code(close_frame.code),
                    reason,
                }
            }))
        }
        TungsteniteMessage::Frame(_frame) => panic!(),
    }
}

fn axum_to_tungstenite_close_code(close_code: u16) -> TungsteniteCloseCode {
    use axum::extract::ws::close_code::*;
    match close_code {
        NORMAL => TungsteniteCloseCode::Normal,
        AWAY => TungsteniteCloseCode::Away,
        PROTOCOL => TungsteniteCloseCode::Protocol,
        UNSUPPORTED => TungsteniteCloseCode::Unsupported,
        STATUS => TungsteniteCloseCode::Status,
        ABNORMAL => TungsteniteCloseCode::Abnormal,
        INVALID => TungsteniteCloseCode::Invalid,
        POLICY => TungsteniteCloseCode::Policy,
        SIZE => TungsteniteCloseCode::Size,
        EXTENSION => TungsteniteCloseCode::Extension,
        ERROR => TungsteniteCloseCode::Error,
        RESTART => TungsteniteCloseCode::Restart,
        AGAIN => TungsteniteCloseCode::Again,
        _ => todo!(),
    }
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
