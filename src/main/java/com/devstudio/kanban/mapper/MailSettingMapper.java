package com.devstudio.kanban.mapper;

import com.devstudio.kanban.entity.MailSetting;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface MailSettingMapper {

    MailSetting select();

    int upsert(MailSetting setting);
}
