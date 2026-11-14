package com.hourglass.dto;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * myTasksWhere 的搜索分支取 itemNo，「我的工作」跨空间搜索必须认同一个编号口径。
 * 三条 SQL（列表 / 计数 / 覆盖空间）共用片段，属性缺失会在运行期抛 OGNL 异常。
 */
class MyTasksQueryItemNoTest {

    @Test
    void numberIsDerivedFromQ() {
        MyTasksQuery query = new MyTasksQuery();
        query.setQ("WI-003");
        assertEquals(Integer.valueOf(3), query.getItemNo());

        query.setQ("wi12");
        assertEquals(Integer.valueOf(12), query.getItemNo());

        query.setQ(" 5 ");
        assertEquals(Integer.valueOf(5), query.getItemNo());
    }

    @Test
    void textSearchKeepsNumberMatchingOff() {
        MyTasksQuery query = new MyTasksQuery();
        assertNull(query.getItemNo());

        query.setQ("登录超时");
        assertNull(query.getItemNo());

        query.setQ("REL-001");
        assertNull(query.getItemNo());
    }
}
