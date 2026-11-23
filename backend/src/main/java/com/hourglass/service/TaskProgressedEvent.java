package com.hourglass.service;

/** 工作项进入处理态：状态同步规则据此判断是否自动开始版本。 */
public class TaskProgressedEvent {

    private final String workspaceId;
    private final String userId;
    private final String taskId;
    private final String reqId;
    private final String boardColumn;

    public TaskProgressedEvent(String workspaceId, String userId, String taskId, String reqId, String boardColumn) {
        this.workspaceId = workspaceId;
        this.userId = userId;
        this.taskId = taskId;
        this.reqId = reqId;
        this.boardColumn = boardColumn;
    }

    public String getWorkspaceId() { return workspaceId; }
    public String getUserId() { return userId; }
    public String getTaskId() { return taskId; }
    public String getReqId() { return reqId; }
    public String getBoardColumn() { return boardColumn; }
}
