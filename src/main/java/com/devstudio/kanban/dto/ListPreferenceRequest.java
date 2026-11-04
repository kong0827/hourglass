package com.devstudio.kanban.dto;

import lombok.Data;

import java.util.List;

@Data
public class ListPreferenceRequest {

    private String viewMode;
    private List<String> columns;
}
