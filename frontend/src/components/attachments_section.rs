//! Slice 7: reusable attachments section.
//!
//! Used by Part detail (kind = "PartAttachment"), Footprint editor
//! (kind = "FootprintImage" or "FootprintAttachment"), Manufacturer
//! (kind = "ManufacturerICLogo"), StorageLocation (kind =
//! "StorageLocationImage").
//!
//! Renders:
//! - A `+ Attach files` button (file picker, multiple) at the top.
//! - Image-typed rows show a 200×200 JPEG thumbnail; everything else
//!   shows a generic doc icon.
//! - Each row: filename, mime, size, description (read-only here for
//!   now — edit-description UI is a future polish), download link,
//!   delete button.

use leptos::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::spawn_local;
use web_sys::HtmlInputElement;

use crate::api::{self, http_get};
use crate::types::PartAttachmentView;
use crate::DataVersion;

/// Generic attachments view. Caller passes `kind` (PascalCase Doctrine
/// class) and `upload_path` (the relative API path that POSTs to the
/// right parent entity, e.g. `/api/parts/123/attachments`).
#[component]
pub fn AttachmentsSection(
    kind: &'static str,
    upload_path: String,
    attachments: Vec<PartAttachmentView>,
) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;

    let uploading = RwSignal::new(false);
    let upload_error = RwSignal::new(None::<String>);
    let file_input_ref = NodeRef::<leptos::html::Input>::new();
    // URL-fetch state. When `url_open` is true, a small inline form
    // shows up next to the buttons asking for a URL + optional filename.
    let url_open = RwSignal::new(false);
    let url_input = RwSignal::new(String::new());
    let url_filename = RwSignal::new(String::new());

    let on_pick = {
        let upload_path = upload_path.clone();
        move |_: leptos::ev::MouseEvent| {
            if let Some(input) = file_input_ref.get() {
                input.click();
            }
        }
    };

    let on_change = {
        let upload_path = upload_path.clone();
        move |ev: leptos::ev::Event| {
            let input: HtmlInputElement = match ev.target().and_then(|t| t.dyn_into().ok()) {
                Some(i) => i,
                None => return,
            };
            let files = match input.files() {
                Some(f) if f.length() > 0 => f,
                _ => return,
            };
            uploading.set(true);
            upload_error.set(None);
            let upload_path = upload_path.clone();
            spawn_local(async move {
                let res = api::upload_files(&upload_path, &files).await;
                uploading.set(false);
                match res {
                    Ok(_) => {
                        data_version.update(|v| *v += 1);
                    }
                    Err(e) => upload_error.set(Some(e.0)),
                }
            });
            // Clear the input so picking the same file twice still fires.
            input.set_value("");
        }
    };

    // (URL-fetch submit happens inline in the on:click closure below;
    // factoring it out into a named closure tripped over Fn-vs-FnOnce
    // when the outer view! macro wraps Show's children as Fn.)

    let count = attachments.len();
    let header = format!("Attachments ({count})");

    // Build the table fragment once, eagerly. Either rendered or
    // dropped — keeps the outer view! happy with Fn-only closures.
    let table_or_empty: leptos::prelude::AnyView = if count == 0 {
        view! {
            <p class="muted" style:padding="6px 0">"No attachments yet."</p>
        }.into_any()
    } else {
        let rows: Vec<_> = attachments
            .into_iter()
            .map(|a| view! { <AttachmentRow kind=kind a=a/> })
            .collect();
        view! {
            <table class="sub attachments-table">
                <thead><tr>
                    <th style="width:48px"></th>
                    <th>"Filename"</th>
                    <th>"Description"</th>
                    <th class="right">"Size"</th>
                    <th class="right" style="width:32px"></th>
                </tr></thead>
                <tbody>{rows}</tbody>
            </table>
        }.into_any()
    };

    view! {
        <h3 class="collapsible attachments-header">
            <span class="chev">"▼"</span>
            <span class="attachments-title">{header}</span>
            <button class="btn-info btn-attach"
                prop:disabled=move || uploading.get()
                on:click=move |_| url_open.update(|v| *v = !*v)>
                "+ From URL"
            </button>
            <button class="btn-success btn-attach"
                prop:disabled=move || uploading.get()
                on:click=on_pick>{
                    move || if uploading.get() { "Uploading…" } else { "+ Attach files" }
                }</button>
            <input type="file" multiple
                node_ref=file_input_ref
                style:display="none"
                on:change=on_change/>
        </h3>
        <Show when=move || url_open.get()>
            <div class="attach-by-url">
                <input type="text" placeholder="https://example.com/datasheet.pdf"
                    prop:value={move || url_input.get()}
                    on:input=move |ev: leptos::ev::Event| {
                        let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                            .map(|e| e.value()).unwrap_or_default();
                        url_input.set(v);
                    }/>
                <input type="text" placeholder="Save-as filename (optional)"
                    prop:value={move || url_filename.get()}
                    on:input=move |ev: leptos::ev::Event| {
                        let v = ev.target().and_then(|t| t.dyn_into::<HtmlInputElement>().ok())
                            .map(|e| e.value()).unwrap_or_default();
                        url_filename.set(v);
                    }/>
                <button class="btn-success"
                    prop:disabled={move || uploading.get() || url_input.get().trim().is_empty()}
                    on:click={
                        let upload_path = upload_path.clone();
                        move |_| {
                            let url = url_input.get().trim().to_string();
                            if url.is_empty() { return; }
                            let filename = url_filename.get().trim().to_string();
                            let filename_opt = if filename.is_empty() { None } else { Some(filename) };
                            let upload_path = upload_path.clone();
                            uploading.set(true);
                            upload_error.set(None);
                            spawn_local(async move {
                                let res = api::upload_by_url(
                                    &upload_path, &url, filename_opt.as_deref()
                                ).await;
                                uploading.set(false);
                                match res {
                                    Ok(_) => {
                                        data_version.update(|v| *v += 1);
                                        url_open.set(false);
                                        url_input.set(String::new());
                                        url_filename.set(String::new());
                                    }
                                    Err(e) => upload_error.set(Some(e.0)),
                                }
                            });
                        }
                    }>{
                        move || if uploading.get() { "Fetching…" } else { "Fetch" }
                    }</button>
                <button class="btn-secondary"
                    on:click=move |_| { url_open.set(false); upload_error.set(None); }>"Cancel"</button>
            </div>
        </Show>
        <Show when=move || upload_error.get().is_some()>
            <div class="modal-error" style:margin="6px 0">
                {move || upload_error.get().unwrap_or_default()}
            </div>
        </Show>
        {table_or_empty}
    }
}

#[component]
fn AttachmentRow(kind: &'static str, a: PartAttachmentView) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let id = a.id;
    let filename = a.original_filename.clone().unwrap_or_else(|| a.filename.clone());
    let is_image = a.is_image.unwrap_or(false);
    let download_url = api::file_url(kind, id);
    let thumb_url = api::thumb_url(kind, id);
    let description = a.description.clone().unwrap_or_default();
    let size = a.size;

    // Each downstream consumer of these strings needs its own clone
    // because they're moved into separate view-fragment closures.
    let filename_for_link = filename.clone();
    let filename_for_alt = filename.clone();
    let url_for_thumb_link = download_url.clone();
    let url_for_name_link = download_url.clone();

    let deleting = RwSignal::new(false);
    let on_delete = {
        let filename = filename.clone();
        move |_: leptos::ev::MouseEvent| {
            let confirm_msg = format!("Delete attachment \"{}\"?", filename);
            let confirmed = web_sys::window()
                .and_then(|w| w.confirm_with_message(&confirm_msg).ok())
                .unwrap_or(false);
            if !confirmed {
                return;
            }
            deleting.set(true);
            spawn_local(async move {
                match api::delete_attachment(kind, id).await {
                    Ok(()) => {
                        data_version.update(|v| *v += 1);
                    }
                    Err(e) => {
                        deleting.set(false);
                        let _ = web_sys::window()
                            .and_then(|w| w.alert_with_message(&format!("Delete failed: {}", e.0)).ok());
                    }
                }
            });
        }
    };

    // Empty alt text on the thumbnail: when the thumbnail URL 404s
    // (legacy file never produced one), we don't want the browser to
    // fall back to the filename string — that gives the visual impression
    // of a duplicate filename in the row.
    let _ = filename_for_alt;

    view! {
        <tr>
            <td class="attach-thumb-cell">
                <Show when=move || is_image>
                    <a href={url_for_thumb_link.clone()} target="_blank">
                        <img class="attach-thumb"
                            src={thumb_url.clone()}
                            alt=""/>
                    </a>
                </Show>
                <Show when=move || !is_image>
                    <span class="attach-doc-icon">"📄"</span>
                </Show>
            </td>
            <td>
                // Filename click previews the file in a new tab. The
                // server returns Content-Disposition: inline so PDFs and
                // images render natively; right-click → Save As is
                // available if a local copy is wanted.
                <a class="attach-filename" href=url_for_name_link
                    target="_blank" rel="noopener noreferrer">{filename_for_link}</a>
            </td>
            <td class="muted">{description}</td>
            <td class="right muted">{format_bytes(size)}</td>
            <td class="right">
                <button class="tree-act tree-act-del"
                    title="Delete"
                    prop:disabled=move || deleting.get()
                    on:click=on_delete>"🗑"</button>
            </td>
        </tr>
    }
}

/// Variant of AttachmentsSection that fetches its own data from a
/// list endpoint. Used by the dialog flows (footprint / manufacturer /
/// storage) where the parent dialog doesn't already have the
/// attachments in hand.
#[component]
pub fn AttachmentsSelfLoader(
    kind: &'static str,
    list_path: String,
    upload_path: String,
) -> impl IntoView {
    let data_version = expect_context::<DataVersion>().0;
    let list_path_for_fetch = list_path.clone();
    let resource = LocalResource::new(move || {
        let _ = data_version.get(); // refetch on uploads/deletes
        let path = list_path_for_fetch.clone();
        async move {
            let url = format!("{base}{path}", base = api::API_BASE_PUB);
            http_get(&url).send().await
                .map_err(|e| api::ApiError(e.to_string()))?
                .json::<Vec<PartAttachmentView>>().await
                .map_err(|e| api::ApiError(e.to_string()))
        }
    });

    view! {
        <Suspense fallback=|| view! { <p class="muted">"Loading attachments…"</p> }>
            {move || resource.get().map(|res| match &*res {
                Err(e) => view! {
                    <p class="muted">{format!("Error: {}", e.0)}</p>
                }.into_any(),
                Ok(rows) => {
                    let rows = rows.clone();
                    let upload_path = upload_path.clone();
                    view! {
                        <AttachmentsSection
                            kind=kind
                            upload_path=upload_path
                            attachments=rows/>
                    }.into_any()
                }
            })}
        </Suspense>
    }
}

fn format_bytes(n: i32) -> String {
    let n = n as f64;
    if n < 1024.0 { format!("{} B", n as i64) }
    else if n < 1024.0 * 1024.0 { format!("{:.1} KB", n / 1024.0) }
    else { format!("{:.1} MB", n / (1024.0 * 1024.0)) }
}
