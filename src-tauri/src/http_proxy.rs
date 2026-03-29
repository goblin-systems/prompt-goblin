use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

#[derive(Serialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub fn http_fetch(request: HttpProxyRequest) -> Result<HttpProxyResponse, String> {
    let method = request.method.to_uppercase();

    // Build an agent that treats all status codes as success (no Error::StatusCode).
    // This lets us return 4xx/5xx response bodies to the frontend for error handling.
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .build()
        .into();

    // ureq v3 distinguishes WithBody vs WithoutBody request builders at the type level,
    // so we must branch accordingly. POST, PUT, and PATCH accept bodies; everything else doesn't.
    let needs_body = matches!(method.as_str(), "POST" | "PUT" | "PATCH");

    if needs_body {
        let mut builder = match method.as_str() {
            "POST" => agent.post(&request.url),
            "PUT" => agent.put(&request.url),
            "PATCH" => agent.patch(&request.url),
            _ => unreachable!(),
        };
        for (key, value) in &request.headers {
            builder = builder.header(key.as_str(), value.as_str());
        }
        let result = if let Some(body) = &request.body {
            // Only set a default Content-Type if the frontend didn't already provide one,
            // to avoid duplicate Content-Type headers which some backends reject.
            if !request
                .headers
                .keys()
                .any(|k| k.eq_ignore_ascii_case("content-type"))
            {
                builder = builder.content_type("application/json");
            }
            builder.send(body.as_bytes())
        } else {
            builder.send_empty()
        };
        match result {
            Ok(mut resp) => {
                let status = resp.status().as_u16();
                let body = resp
                    .body_mut()
                    .read_to_string()
                    .map_err(|e| format!("Failed to read response body: {}", e))?;
                Ok(HttpProxyResponse { status, body })
            }
            Err(e) => Err(format!("HTTP request failed: {}", e)),
        }
    } else {
        let mut builder = match method.as_str() {
            "GET" => agent.get(&request.url),
            "DELETE" => agent.delete(&request.url),
            "HEAD" => agent.head(&request.url),
            _ => return Err(format!("Unsupported HTTP method: {}", method)),
        };
        for (key, value) in &request.headers {
            builder = builder.header(key.as_str(), value.as_str());
        }
        match builder.call() {
            Ok(mut resp) => {
                let status = resp.status().as_u16();
                let body = resp
                    .body_mut()
                    .read_to_string()
                    .map_err(|e| format!("Failed to read response body: {}", e))?;
                Ok(HttpProxyResponse { status, body })
            }
            Err(e) => Err(format!("HTTP request failed: {}", e)),
        }
    }
}
