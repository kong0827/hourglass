package com.hourglass.dto;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 发布态是两档枚举；甘特复用看板 SQL 片段，属性名必须两边一致，否则 OGNL 运行期报错。 */
class BoardQueryPubStateTest {

    private static BoardQuery from(String pubState) {
        return BoardQuery.from(null, null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, pubState);
    }

    @Test
    void acceptsOnlyTheTwoSupportedStates() {
        assertEquals("published", from("published").getPubState());
        assertEquals("unpublished", from(" unpublished ").getPubState());
        assertNull(from(null).getPubState());
        assertNull(from("").getPubState());
        assertNull(from("done").getPubState());
    }

    @Test
    void ganttQueryExposesTheSameStateForSharedSql() {
        GanttQuery gantt = GanttQuery.from(from("published"), null, null, null, true);
        assertEquals("published", gantt.getPubState());
    }

    @Test
    void myTasksQueryKeepsTheSameCaliber() {
        MyTasksQuery query = new MyTasksQuery();
        query.setPubState("unpublished");
        assertEquals("unpublished", query.getPubState());
    }
}
