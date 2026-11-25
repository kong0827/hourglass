package com.hourglass.dto;

/**
 * 需求详情的阶段工时汇总（只读）。
 *
 * 口径：测试先按测试窗口取数；需求类工作项的其余计时归「产品 / 设计」，
 * 任务与缺陷的其余计时归「开发」；史诗不参与工时。三段互不重叠，合计等于实际。
 * 预估按字段拆：需求类取预计耗时，任务 / 缺陷取预计耗时，测试预估取测试预估。
 */
public class DemandHoursView {

    /** 参与统计的工作项数（不含史诗） */
    private int taskCount;
    /** 至少填了一项预估的工作项数 */
    private int estimatedCount;
    /** 没有任何预估的工作项数 */
    private int unestimatedCount;

    private long productEstimateMinutes;
    private long productActualMinutes;
    private long devEstimateMinutes;
    private long devActualMinutes;
    private long testEstimateMinutes;
    private long testActualMinutes;

    public long getEstimateMinutes() {
        return productEstimateMinutes + devEstimateMinutes + testEstimateMinutes;
    }

    public long getActualMinutes() {
        return productActualMinutes + devActualMinutes + testActualMinutes;
    }

    public int getTaskCount() {
        return taskCount;
    }

    public void setTaskCount(int taskCount) {
        this.taskCount = taskCount;
    }

    public int getEstimatedCount() {
        return estimatedCount;
    }

    public void setEstimatedCount(int estimatedCount) {
        this.estimatedCount = estimatedCount;
    }

    public int getUnestimatedCount() {
        return unestimatedCount;
    }

    public void setUnestimatedCount(int unestimatedCount) {
        this.unestimatedCount = unestimatedCount;
    }

    public long getProductEstimateMinutes() {
        return productEstimateMinutes;
    }

    public void setProductEstimateMinutes(long productEstimateMinutes) {
        this.productEstimateMinutes = productEstimateMinutes;
    }

    public long getProductActualMinutes() {
        return productActualMinutes;
    }

    public void setProductActualMinutes(long productActualMinutes) {
        this.productActualMinutes = productActualMinutes;
    }

    public long getDevEstimateMinutes() {
        return devEstimateMinutes;
    }

    public void setDevEstimateMinutes(long devEstimateMinutes) {
        this.devEstimateMinutes = devEstimateMinutes;
    }

    public long getDevActualMinutes() {
        return devActualMinutes;
    }

    public void setDevActualMinutes(long devActualMinutes) {
        this.devActualMinutes = devActualMinutes;
    }

    public long getTestEstimateMinutes() {
        return testEstimateMinutes;
    }

    public void setTestEstimateMinutes(long testEstimateMinutes) {
        this.testEstimateMinutes = testEstimateMinutes;
    }

    public long getTestActualMinutes() {
        return testActualMinutes;
    }

    public void setTestActualMinutes(long testActualMinutes) {
        this.testActualMinutes = testActualMinutes;
    }
}
