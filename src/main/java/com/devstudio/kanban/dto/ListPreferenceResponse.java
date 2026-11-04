package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.List;

@Data
public class ListPreferenceResponse {

    private final String viewKey;
    private final String viewMode;
    private final List<String> columns;

    public ListPreferenceResponse(String viewKey, String viewMode, List<String> columns) {
        this.viewKey = viewKey;
        this.viewMode = viewMode;
        this.columns = columns;
    }
}
