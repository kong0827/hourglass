package com.hourglass.dto;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 编号搜索：全局搜索直接 setQ，不走 from()，故编号必须从 q 现算。 */
class BoardQueryItemNoTest {

    @Test
    void numberIsDerivedFromQWithoutGoingThroughFrom() {
        BoardQuery query = new BoardQuery();
        query.setQ("WI-003");
        assertEquals(Integer.valueOf(3), query.getItemNo());

        query.setQ("wi12");
        assertEquals(Integer.valueOf(12), query.getItemNo());

        query.setQ(" 5 ");
        assertEquals(Integer.valueOf(5), query.getItemNo());
    }

    @Test
    void textSearchKeepsNumberMatchingOff() {
        BoardQuery query = new BoardQuery();
        assertNull(query.getItemNo());

        query.setQ("登录超时");
        assertNull(query.getItemNo());

        query.setQ("REL-001");
        assertNull(query.getItemNo());
    }

    @Test
    void fromParsesQTheSameWay() {
        BoardQuery query = BoardQuery.from("WI-009", null, null, null, null, null,
                null, null, null, null, null);
        assertEquals(Integer.valueOf(9), query.getItemNo());
        assertEquals("WI-009", query.getQ());
    }

    /**
     * ganttWhere 是看板与甘特共用的 SQL 片段，里面取 query.itemNo。
     * 甘特参数少一个属性就会在运行期抛 OGNL NoSuchPropertyException（单测不跑 SQL 时看不出来），
     * 所以这里把两边的口径钉在一起。
     */
    @Test
    void ganttQueryExposesTheSameNumberCaliber() {
        BoardQuery board = new BoardQuery();
        board.setQ("WI-007");
        GanttQuery gantt = GanttQuery.from(board, null, null, null, true);

        assertEquals(board.getItemNo(), gantt.getItemNo());
        assertEquals(Integer.valueOf(7), gantt.getItemNo());

        gantt.setQ("登录超时");
        assertNull(gantt.getItemNo());
    }
}