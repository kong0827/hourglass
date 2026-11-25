package com.hourglass.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** 草稿证据：来自本周真实痕迹，供用户判断是否确认。 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class CatchupEvidence {

    /** status / time / update / created / blocked / late / plan */
    private String kind;
    private String label;
    private String detail;
    private String at;
}
