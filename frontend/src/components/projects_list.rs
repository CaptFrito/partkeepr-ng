//! Slice 8a: left-pane project list.
//!
//! When LeftPaneMode is Projects, this component takes the place of the
//! tree views. Lists every project (sorted by name) plus a `+ New Project`
//! button at the top.

use leptos::prelude::*;

use crate::api;
use crate::types::ProjectListRow;
use crate::{DataVersion, ProjectEditCtx, ProjectEditMode, ProjectEditState, SelectedProject};

#[component]
pub fn ProjectsList() -> impl IntoView {
    let edit_state = expect_context::<ProjectEditState>().0;
    let data_version = expect_context::<DataVersion>().0;

    let projects = LocalResource::new(move || {
        let _ = data_version.get();
        api::fetch_projects()
    });

    let on_new = move |_| {
        edit_state.set(Some(ProjectEditCtx {
            mode: ProjectEditMode::Create,
            id: 0,
            name: String::new(),
            description: String::new(),
            parts_count: 0,
            runs_count: 0,
        }));
    };

    view! {
        <div class="projects-list">
            <div class="left-toolbar">
                <button class="btn-success" on:click=on_new>
                    "+ New Project"
                </button>
            </div>
            <Suspense fallback=|| view! {
                <p class="muted" style="padding:12px">"Loading projects…"</p>
            }>
                {move || projects.get().map(|res| match &*res {
                    Err(e) => view! {
                        <p class="muted" style="padding:12px">{format!("Error: {}", e.0)}</p>
                    }.into_any(),
                    Ok(rows) => {
                        if rows.is_empty() {
                            return view! {
                                <p class="muted" style="padding:12px">
                                    "No projects yet — click + New Project to create one."
                                </p>
                            }.into_any();
                        }
                        let items: Vec<_> = rows.iter().cloned().collect();
                        view! {
                            <div>
                                {items.into_iter().map(|p| view! { <ProjectsRow p=p/> }).collect::<Vec<_>>()}
                            </div>
                        }.into_any()
                    }
                })}
            </Suspense>
        </div>
    }
}

#[component]
fn ProjectsRow(p: ProjectListRow) -> impl IntoView {
    let selected = expect_context::<SelectedProject>().0;
    let id = p.id;
    let name = p.name.clone();
    let parts = p.parts_count;
    let runs = p.runs_count;

    let summary = if runs > 0 {
        format!("{parts} parts · {runs} runs")
    } else {
        format!("{parts} parts")
    };

    view! {
        <div class="tree-node project-row"
            class:selected=move || selected.get() == Some(id)
            on:click=move |_| selected.set(Some(id))>
            <span class="chev"></span>
            <span class="tree-label">{name}</span>
            <span class="project-row-summary muted">{summary}</span>
        </div>
    }
}
