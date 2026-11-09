package com.hourglass.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ColumnTransitionView {

    /** 参与流转的列（含系统「已完成」列，按显示顺序） */
    private List<BoardResponse.ColumnDef> columns = new ArrayList<BoardResponse.ColumnDef>();

    /** 生效规则全量矩阵；同列不返回 */
    private List<Rule> rules = new ArrayList<Rule>();

    @Data
    public static class Rule {
        private String from;
        private String to;
        private String rule;

        public Rule() {
        }

        public Rule(String from, String to, String rule) {
            this.from = from;
            this.to = to;
            this.rule = rule;
        }
    }
}
