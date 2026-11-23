package com.hourglass.dto;

import lombok.Data;

import java.util.List;

/** 导入回执：成功数、失败行与原因，失败行可下载为 CSV 修正后重导。 */
@Data
public class ImportResult {

    private String kind;
    private int total;
    private int created;
    private int failed;
    private List<Error> errors;
    /** 失败行 CSV（含原始列 + 错误原因），无失败行时为空 */
    private String failedCsv;
    private List<String> ignored;

    @Data
    public static class Error {
        private int row;
        private String message;
    }
}
