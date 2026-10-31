package com.devstudio.kanban.service;

import com.devstudio.kanban.common.Consts;
import com.devstudio.kanban.dto.EstimateStats;
import com.devstudio.kanban.entity.Task;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class EstimateServiceTest {

    private static Task done(String id, int estimate, String category) {
        Task t = new Task();
        t.setId(id);
        t.setBoardColumn(Consts.COL_DONE);
        t.setEstimateMinutes(estimate);
        t.setCategory(category);
        return t;
    }

    private static EstimateStats compute(int estimate, int actual) {
        EstimateService svc = new EstimateService(null, null);
        List<Task> tasks = new ArrayList<Task>();
        tasks.add(done("K1", estimate, "后端"));
        Map<String, Integer> actualMap = new HashMap<String, Integer>();
        actualMap.put("K1", actual);
        return svc.compute(tasks, actualMap);
    }

    @Test
    void accurateBoundariesShareSameConstants() {
        // 0.85 与 1.15 都算准；1.16 才偏乐观
        assertEquals(1, compute(100, 85).getAccurateCount());
        assertEquals(1, compute(100, 115).getAccurateCount());
        assertEquals(1, compute(100, 116).getOverCount());
        assertEquals(1, compute(100, 84).getUnderCount());
        // 结论文案与计数口径一致：不会再出现"既准确又偏保守"
        assertEquals("团队估时挺准：实际投入是预估的 1.15 倍，偏差在可接受范围。",
                EstimateService.suggestionOf(compute(100, 115)));
        assertEquals("团队估时偏保守：实际只用到预估的 84%。可以估得更紧一些，别把缓冲垫得太厚。",
                EstimateService.suggestionOf(compute(100, 84)));
    }

    @Test
    void noTimeLogIsExcludedFromSample() {
        EstimateStats s = compute(100, 0);
        assertEquals(0, s.getSampleCount());
        assertEquals(1, s.getNoTimeCount());
    }
}
