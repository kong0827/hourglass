package com.hourglass.mapper;

import com.hourglass.entity.DeliveryNote;
import com.hourglass.entity.DeliveryNoteShare;
import com.hourglass.entity.DeliveryNoteSnapshot;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DeliveryNoteMapper {

    DeliveryNote selectByVersion(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    DeliveryNote selectByVersionForUpdate(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    int upsert(DeliveryNote note);

    int deleteByWorkspace(@Param("workspaceId") String workspaceId);

    int insertSnapshot(DeliveryNoteSnapshot snapshot);

    DeliveryNoteSnapshot selectSnapshotById(@Param("id") String id);

    /** 列表不带 payload：一份文档几十 KB，列表只需要编号与摘要 */
    List<DeliveryNoteSnapshot> selectSnapshotsByVersion(@Param("workspaceId") String workspaceId,
                                                       @Param("versionId") String versionId);

    Integer selectMaxSeq(@Param("workspaceId") String workspaceId, @Param("versionId") String versionId);

    List<String> selectSnapshotIdsByVersion(@Param("workspaceId") String workspaceId,
                                            @Param("versionId") String versionId);

    int deleteSnapshotsByWorkspace(@Param("workspaceId") String workspaceId);

    DeliveryNoteShare selectShareBySnapshot(@Param("workspaceId") String workspaceId,
                                            @Param("snapshotId") String snapshotId);

    DeliveryNoteShare selectShareByToken(@Param("token") String token);

    int upsertShare(DeliveryNoteShare share);

    int deleteShare(@Param("workspaceId") String workspaceId, @Param("snapshotId") String snapshotId);

    int increaseViewCount(@Param("workspaceId") String workspaceId, @Param("snapshotId") String snapshotId);

    int deleteSharesByWorkspace(@Param("workspaceId") String workspaceId);
}