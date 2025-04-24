use axum::{
    body::Body,
    extract::{Request, State},
    http::{Response, StatusCode},
    response::IntoResponse,
    routing::any,
    Router,
};
use axum_macros::debug_handler;
use reqwest::Client;

const HOLY_CLUSTER_URL: &str = "https://holycluster.iarc.org";

#[tokio::main]
async fn main() {
    let client = Client::new();

    let app = Router::new().fallback(any(proxy)).with_state(client);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[debug_handler]
async fn proxy(State(client): State<Client>, request: Request<Body>) -> Response<Body> {
    let uri_string = format!(
        "{}{}",
        HOLY_CLUSTER_URL,
        request
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or("")
    );
    let reqwest_response = match client.get(uri_string).send().await {
        Ok(res) => res,
        Err(_) => {
            return (StatusCode::BAD_REQUEST, Body::empty()).into_response();
        }
    };

    let mut response_builder = Response::builder().status(reqwest_response.status());
    *response_builder.headers_mut().unwrap() = reqwest_response.headers().clone();
    response_builder
        .body(Body::from_stream(reqwest_response.bytes_stream()))
        .unwrap()
}
