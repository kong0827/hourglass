package com.hourglass.mapper;

import com.hourglass.entity.MailSetting;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface MailSettingMapper {

    MailSetting select();

    int upsert(MailSetting setting);
}
