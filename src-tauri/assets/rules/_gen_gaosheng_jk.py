# -*- coding: utf-8 -*-
"""Generate gaosheng-jk.json (mixed AA55 + MDB)."""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).with_name("gaosheng-jk.json")


def cmd(
    c: int,
    name: str,
    title: str,
    *,
    length: int | None = None,
    dir_: str | None = None,
    prefix: list[int] | None = None,
    decode: list | None = None,
    role: str | None = None,
    sub: int | None = None,
    checksum: str | None = None,
) -> dict:
    d: dict = {"cmd": c, "name": name, "title": title}
    if length is not None:
        d["len"] = length
    if dir_ is not None:
        d["dir"] = dir_
    if prefix:
        d["payload_prefix"] = prefix
    if decode:
        d["decode"] = decode
    if role is not None:
        d["role"] = role
    if sub is not None:
        d["sub"] = sub
    if checksum is not None:
        d["checksum"] = checksum
    return d


def uint(id_: str, offset: int, width: int, label: str, endian: str = "be") -> dict:
    return {
        "type": "uint",
        "id": id_,
        "offset": offset,
        "width": width,
        "endian": endian,
        "label": label,
    }


def bits(from_: str, start: int, width: int, id_: str, label: str, mapping: dict) -> dict:
    return {
        "type": "bits",
        "from": from_,
        "start": start,
        "width": width,
        "id": id_,
        "label": label,
        "map": {str(k): v for k, v in mapping.items()},
    }


def flags(from_: str, bits_list: list[dict], id_: str | None = None) -> dict:
    d = {"type": "flags", "from": from_, "bits": bits_list}
    if id_:
        d["id"] = id_
    return d


def hex_dump(id_: str = "payload", label: str = "载荷") -> dict:
    return {"type": "hex_dump", "id": id_, "label": label}


def pay_commands() -> list[dict]:
    status_flags = [
        flags(
            "chg",
            [
                {"bit": 0, "label": "A148 找零器离线", "fault": True, "code": "A148"},
                {"bit": 1, "label": "A149 找零器缺币", "fault": True, "code": "A149"},
                {"bit": 2, "label": "A150 找零器少币", "fault": True, "code": "A150"},
                {"bit": 4, "label": "A151 找零器出币没有回转", "fault": True, "code": "A151"},
                {"bit": 5, "label": "A152 找零器出币口感应器异常", "fault": True, "code": "A152"},
            ],
        ),
        flags(
            "bill",
            [{"bit": 0, "label": "A153 纸币器离线", "fault": True, "code": "A153"}],
        ),
        flags(
            "card",
            [{"bit": 0, "label": "A154 刷卡器离线", "fault": True, "code": "A154"}],
        ),
    ]
    return [
        cmd(0x20, "PayStatusTx", "读取支付设备状态", length=5, dir_="tx"),
        cmd(
            0x20,
            "PayStatusRx",
            "读取支付设备状态",
            length=8,
            dir_="rx",
            decode=[
                uint("chg", 0, 1, "找零器"),
                uint("bill", 1, 1, "纸币器"),
                uint("card", 2, 1, "刷卡器"),
                *status_flags,
            ],
        ),
        cmd(
            0x21,
            "PayConfigV1",
            "支付配置(V1)",
            length=8,
            dir_="tx",
            decode=[
                uint("way", 0, 1, "支付方式"),
                bits("way", 0, 8, "pay_type", "方式", {1: "现金", 2: "刷卡"}),
                uint("price", 1, 2, "金额"),
            ],
        ),
        cmd(
            0x21,
            "PayConfigV1Rx",
            "支付配置(V1)",
            length=6,
            dir_="rx",
            decode=[
                uint("sta", 0, 1, "状态"),
                bits("sta", 0, 8, "ok", "结果", {0: "成功"}),
            ],
        ),
        cmd(
            0x21,
            "PayCreateGeneral",
            "通用支付创建订单",
            length=10,
            dir_="tx",
            decode=[
                uint("unit", 0, 1, "金额单位"),
                uint("amount", 1, 2, "金额"),
                uint("serial", 3, 2, "流水号"),
            ],
        ),
        cmd(
            0x22,
            "PayChange",
            "找零/取消支付",
            length=6,
            decode=[uint("count", 0, 1, "找零枚数")],
        ),
        cmd(0x22, "PayCancelGeneral", "通用支付取消", length=5),
        cmd(
            0x23,
            "PayReadAmountV1",
            "读取支付金额(V1)",
            length=5,
            dir_="tx",
        ),
        cmd(
            0x23,
            "PayReadAmountV1Rx",
            "读取支付金额(V1)",
            length=11,
            dir_="rx",
            decode=[
                uint("coin", 0, 2, "硬币代币"),
                uint("bill", 2, 2, "纸币代币"),
                uint("card", 4, 2, "刷卡代币"),
            ],
        ),
        cmd(
            0x24,
            "PayTransaction",
            "交易结果通知",
            length=6,
            decode=[
                uint("result", 0, 1, "结果"),
                bits("result", 0, 8, "tx_result", "交易结果", {0: "成功", 1: "失败"}),
            ],
        ),
        cmd(
            0x28,
            "PayConfigV2",
            "支付配置(V2)",
            length=14,
            decode=[
                uint("way", 0, 1, "支付方式"),
                bits("way", 0, 8, "pay_type", "方式", {1: "现金", 2: "刷卡"}),
                hex_dump("product", "商品号"),
                uint("price", 5, 4, "金额"),
            ],
        ),
        cmd(0x29, "PayReadAmountV2Tx", "读取支付金额(V2)", length=5, dir_="tx"),
        cmd(
            0x29,
            "PayReadAmountV2Rx",
            "读取支付金额(V2)",
            length=17,
            dir_="rx",
            decode=[
                uint("coin", 0, 4, "硬币代币"),
                uint("bill", 4, 4, "纸币代币"),
                uint("card", 8, 4, "刷卡代币"),
            ],
        ),
        cmd(
            0x2A,
            "PayConfirm",
            "金额确定(V2)",
            length=17,
            dir_="tx",
            decode=[
                uint("coin", 0, 4, "硬币代币"),
                uint("bill", 4, 4, "纸币代币"),
                uint("card", 8, 4, "刷卡代币"),
            ],
        ),
        cmd(
            0x2A,
            "PayConfirmRx",
            "金额确定(V2)",
            length=6,
            dir_="rx",
            decode=[
                uint("sta", 0, 1, "结果"),
                bits("sta", 0, 8, "match", "金额比对", {0: "一致", 1: "不一致"}),
            ],
        ),
        cmd(0x2B, "PayStopCash", "暂停现金投币(V2)", length=6),
        cmd(0x08, "PayQueryGeneralTx", "通用支付查询状态", length=5, dir_="tx"),
        cmd(
            0x08,
            "PayQueryGeneralRx",
            "通用支付查询状态",
            length=6,
            dir_="rx",
            decode=[
                uint("sta", 0, 1, "状态"),
                bits(
                    "sta",
                    0,
                    8,
                    "pay_sta",
                    "扣款状态",
                    {0: "成功", 255: "失败"},
                ),
            ],
        ),
    ]


def device_status_flags() -> list[dict]:
    """ST_INFO1 bit0=LSB of BE u32 at payload[0:4], matching DeviceStatusCommand."""
    return [
        uint("st_info1", 0, 4, "ST_INFO1"),
        bits(
            "st_info1",
            0,
            2,
            "status",
            "status",
            {0: "NORMAL", 1: "BUSY", 2: "ABNORMAL", 3: "ERROR"},
        ),
        flags(
            "st_info1",
            [
                {"bit": 2, "label": "E14 前门模组离线", "fault": True, "code": "E14"},
                {"bit": 3, "label": "E15 制冰模组离线", "fault": True, "code": "E15"},
                {"bit": 4, "label": "E10 研磨模组离线", "fault": True, "code": "E10"},
                {"bit": 5, "label": "前门故障", "fault": True},
                {"bit": 6, "label": "E16 制冰故障位", "fault": True, "code": "E16"},
                {"bit": 7, "label": "E17 研磨故障位", "fault": True, "code": "E17"},
                {"bit": 8, "label": "E02 落杯器无杯", "fault": True, "code": "E02"},
                {"bit": 9, "label": "A01 无盖", "fault": True, "code": "A01"},
                {"bit": 10, "label": "E01 缺水", "fault": True, "code": "E01"},
                {"bit": 11, "label": "A100", "fault": True, "code": "A100"},
                {"bit": 12, "label": "E25 通电首次加热", "fault": True, "code": "E25"},
                {"bit": 13, "label": "A09", "fault": True, "code": "A09"},
                {"bit": 14, "label": "A166", "fault": True, "code": "A166"},
                {"bit": 15, "label": "E04 传感器故障", "fault": True, "code": "E04"},
                {"bit": 16, "label": "A10", "fault": True, "code": "A10"},
                {"bit": 17, "label": "A11", "fault": True, "code": "A11"},
                {"bit": 18, "label": "A12", "fault": True, "code": "A12"},
                {"bit": 19, "label": "A13", "fault": True, "code": "A13"},
                {"bit": 20, "label": "A14", "fault": True, "code": "A14"},
                {"bit": 21, "label": "A15", "fault": True, "code": "A15"},
                {"bit": 22, "label": "A16", "fault": True, "code": "A16"},
                {"bit": 23, "label": "A17", "fault": True, "code": "A17"},
                {"bit": 24, "label": "E19", "fault": True, "code": "E19"},
                {"bit": 25, "label": "A05", "fault": True, "code": "A05"},
                {"bit": 26, "label": "A06", "fault": True, "code": "A06"},
                {"bit": 27, "label": "E20", "fault": True, "code": "E20"},
                {"bit": 30, "label": "E12 轨道故障", "fault": True, "code": "E12"},
                {"bit": 31, "label": "A116", "fault": True, "code": "A116"},
            ],
        ),
        hex_dump(),
    ]


def vmc_commands() -> list[dict]:
    em_map = {i: ("NORMAL" if i == 0 else f"EM{i:02d}") for i in range(0, 27)}
    return [
        cmd(
            0x1E,
            "DeviceStatusTx",
            "查询设备状态",
            length=5,
            dir_="tx",
        ),
        cmd(
            0x1E,
            "DeviceStatusRx",
            "查询设备状态",
            dir_="rx",
            decode=device_status_flags(),
        ),
        cmd(
            0x0C,
            "OldErrorCode",
            "查询错误代码(旧协议)",
            decode=[
                uint("err", 0, 1, "ErrorCode"),
                flags(
                    "err",
                    [
                        {"bit": 0, "label": "E01 缺水", "fault": True, "code": "E01"},
                        {"bit": 1, "label": "E02 缺杯", "fault": True, "code": "E02"},
                        {"bit": 2, "label": "E03 缺水且缺杯", "fault": True, "code": "E03"},
                        {"bit": 3, "label": "E04 传感器故障", "fault": True, "code": "E04"},
                        {"bit": 5, "label": "E12 轨道故障", "fault": True, "code": "E12"},
                        {"bit": 6, "label": "A01 无盖", "fault": True, "code": "A01"},
                        {"bit": 7, "label": "E25 通电首次加热", "fault": True, "code": "E25"},
                    ],
                ),
            ],
        ),
        cmd(0x1F, "MakingStatusTx", "查询制作状态", length=5, dir_="tx"),
        cmd(
            0x1F,
            "MakingStatusRx",
            "查询制作状态",
            dir_="rx",
            decode=[
                uint("dk", 0, 4, "DK_INFO"),
                bits("dk", 0, 4, "drink_no", "饮料编号", {i: str(i) for i in range(16)}),
                bits("dk", 4, 1, "is_hot", "冷热", {0: "热", 1: "冷"}),
                bits("dk", 5, 1, "is_local", "制饮类型", {0: "本地", 1: "非本地"}),
                bits("dk", 6, 1, "wait_cup", "等待取杯", {0: "否", 1: "是"}),
                bits("dk", 7, 1, "drop_cup", "成功落杯", {0: "否", 1: "是"}),
                bits("dk", 10, 7, "cur_step", "当前步骤", {i: str(i) for i in range(128)}),
                bits("dk", 17, 7, "total_step", "总步骤", {i: str(i) for i in range(128)}),
                bits("dk", 24, 6, "fail", "失败原因", em_map),
                bits(
                    "dk",
                    30,
                    2,
                    "outcome",
                    "执行结果",
                    {0: "进行中", 1: "成功", 2: "失败", 3: "未知"},
                ),
            ],
        ),
        cmd(
            0x01,
            "MakeDrink",
            "开始制作饮品",
            length=7,
            decode=[
                uint("drink", 0, 1, "饮料号"),
                uint("locale", 1, 1, "本地/非本地"),
            ],
        ),
        cmd(
            0x1D,
            "SetMakeStep",
            "设置制作流程",
            decode=[uint("drink_type", 0, 1, "饮品类型"), hex_dump("steps", "步骤")],
        ),
        cmd(
            0x2C,
            "FirmwareInfo",
            "控制板基本信息",
            decode=[uint("pcbat", 0, 1, "PCBAT"), hex_dump()],
        ),
        cmd(
            0x24,
            "SendCup",
            "送杯指令",
            length=7,
            decode=[uint("mode", 0, 1, "模式"), uint("wait_s", 1, 1, "开门等待秒")],
        ),
        cmd(
            0x20,
            "MainVersion",
            "旧-控制板基本信息",
            length=11,
            prefix=[0x01, 0x03, 0x02, 0x23, 0x00, 0x06],
            decode=[hex_dump()],
        ),
        cmd(
            0x20,
            "MainModule01",
            "查询主控模组状态",
            length=11,
            prefix=[0x01, 0x03],
            decode=[
                uint("addr", 0, 1, "模组地址"),
                uint("fc", 1, 1, "功能码"),
                hex_dump(),
            ],
        ),
        cmd(
            0x20,
            "DoorModule",
            "查询前门模组状态",
            length=11,
            prefix=[0x02],
            decode=[
                uint("addr", 0, 1, "模组地址"),
                uint("fc", 1, 1, "功能码"),
                hex_dump(),
            ],
        ),
        cmd(
            0x20,
            "IceModule",
            "查询制冰模组状态",
            length=11,
            prefix=[0x03],
            decode=[
                uint("addr", 0, 1, "模组地址"),
                uint("fc", 1, 1, "功能码"),
                hex_dump(),
            ],
        ),
        cmd(
            0x20,
            "ModuleQuery",
            "模组查询",
            decode=[
                uint("addr", 0, 1, "模组地址"),
                uint("fc", 1, 1, "功能码"),
                hex_dump(),
            ],
        ),
        cmd(0x04, "HotTemp", "热水温度", decode=[hex_dump()]),
        cmd(0x05, "ColdTemp", "冷水温度", decode=[hex_dump()]),
        cmd(0x07, "SetCupMethod", "设置落杯方式", decode=[hex_dump()]),
        cmd(0x0B, "OldDeviceStatus", "旧协议设备状态", decode=[hex_dump()]),
        cmd(0x15, "SetOldRecipe", "设置旧配方", decode=[hex_dump()]),
        cmd(0x17, "GroundComplete", "研磨完成通知", decode=[hex_dump()]),
        cmd(0x1A, "TestCommand", "测试指令", decode=[hex_dump()]),
        cmd(0x1B, "LockCommand", "门锁", decode=[hex_dump()]),
        cmd(0x1C, "ReplenishWater", "补水", decode=[hex_dump()]),
        cmd(0x26, "Reboot", "重启", decode=[hex_dump()]),
        cmd(0x27, "CleanDevice", "清洗设备", decode=[hex_dump()]),
        cmd(0x29, "DrainWater", "排水", decode=[hex_dump()]),
        cmd(0x2A, "DropCupModuleStatus", "落杯模组状态", decode=[hex_dump()]),
        cmd(0x12, "CleanPipe", "清洗管路", decode=[hex_dump()]),
        cmd(0x0A, "CleanAllPipe", "清洗全部管路", decode=[hex_dump()]),
        cmd(0x21, "GroundOrLight", "研磨动作/灯光", decode=[hex_dump()]),
    ]


def mdb_cmd(
    c: int,
    name: str,
    title: str,
    *,
    role: str,
    dir_: str | None = None,
    sub: int | None = None,
    length: int | None = None,
    checksum: str | None = None,
    decode: list | None = None,
) -> dict:
    return cmd(
        c,
        name,
        title,
        role=role,
        dir_=dir_,
        sub=sub,
        length=length,
        checksum=checksum,
        decode=decode,
    )


def mdb_commands() -> list[dict]:
    """Core MDB commands from coffee-machine lib-hw-payment + common reports."""
    out: list[dict] = [
        mdb_cmd(0x00, "Ack", "ACK", role="control", dir_="rx", length=1, checksum="none"),
        mdb_cmd(0xFF, "Nak", "NAK", role="control", dir_="rx", length=1, checksum="none"),
        mdb_cmd(0xAA, "Ret", "RET", role="control", dir_="rx", length=1, checksum="none"),
        # Cashless #1
        mdb_cmd(0x10, "ClReset", "刷卡器重置", role="command", dir_="tx", checksum="none"),
        mdb_cmd(
            0x11,
            "ClSetup",
            "刷卡器初始化",
            role="command",
            dir_="tx",
            sub=0x00,
            checksum="none",
        ),
        mdb_cmd(
            0x11,
            "ClSetupReply",
            "刷卡器初始化应答",
            role="reply",
            dir_="rx",
            sub=0x00,
            checksum="sum8_tail",
            decode=[
                uint("level", 1, 1, "功能等级"),
                uint("country", 2, 2, "国家货币码"),
                uint("scale", 4, 1, "缩放系数"),
                uint("decimals", 5, 1, "小数位"),
            ],
        ),
        mdb_cmd(
            0x11,
            "ClMaxMin",
            "刷卡器设置最大最小价格",
            role="command",
            dir_="tx",
            sub=0x01,
            checksum="none",
        ),
        mdb_cmd(
            0x17,
            "ClReadId",
            "刷卡器读取设备ID",
            role="command",
            dir_="tx",
            sub=0x00,
            checksum="none",
        ),
        mdb_cmd(
            0x17,
            "ClReadIdReply",
            "刷卡器设备ID应答",
            role="reply",
            dir_="rx",
            sub=0x00,
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x14,
            "ClEnable",
            "刷卡器开启会话",
            role="command",
            dir_="tx",
            sub=0x01,
            checksum="none",
        ),
        mdb_cmd(
            0x14,
            "ClDisable",
            "刷卡器结束会话/禁用",
            role="command",
            dir_="tx",
            sub=0x00,
            checksum="none",
        ),
        mdb_cmd(
            0x13,
            "ClVendCancel",
            "刷卡器取消出货",
            role="command",
            dir_="tx",
            sub=0x01,
            checksum="none",
        ),
        mdb_cmd(
            0x13,
            "ClVendReq",
            "刷卡器请求出货",
            role="command",
            dir_="tx",
            sub=0x00,
            checksum="none",
            decode=[uint("price", 0, 2, "价格"), uint("item", 2, 2, "货道")],
        ),
        mdb_cmd(
            0x13,
            "ClVendOk",
            "刷卡器出货成功",
            role="command",
            dir_="tx",
            sub=0x02,
            checksum="none",
        ),
        mdb_cmd(
            0x13,
            "ClVendFail",
            "刷卡器出货失败",
            role="command",
            dir_="tx",
            sub=0x03,
            checksum="none",
        ),
        mdb_cmd(
            0x13,
            "ClSessionComplete",
            "刷卡器结束会话",
            role="command",
            dir_="tx",
            sub=0x04,
            checksum="none",
        ),
        mdb_cmd(
            0x12,
            "ClPoll",
            "刷卡器轮询",
            role="command",
            dir_="tx",
            checksum="none",
        ),
        # Coin
        mdb_cmd(0x08, "CoinReset", "硬币器重置", role="command", dir_="tx", checksum="none"),
        mdb_cmd(0x09, "CoinSetup", "硬币器初始化", role="command", dir_="tx", checksum="none"),
        mdb_cmd(
            0x09,
            "CoinSetupReply",
            "硬币器初始化应答",
            role="reply",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(0x0A, "CoinTube", "硬币器查询钱箱状态", role="command", dir_="tx", checksum="none"),
        mdb_cmd(
            0x0A,
            "CoinTubeReply",
            "硬币器钱箱状态应答",
            role="reply",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(0x0B, "CoinPoll", "硬币器轮询", role="command", dir_="tx", checksum="none"),
        mdb_cmd(
            0x0C,
            "CoinEnable",
            "硬币器开始收钱",
            role="command",
            dir_="tx",
            checksum="none",
        ),
        mdb_cmd(
            0x0C,
            "CoinDisable",
            "硬币器停止收钱",
            role="command",
            dir_="tx",
            checksum="none",
        ),
        mdb_cmd(
            0x0F,
            "CoinFeatureEnable",
            "硬币器功能使能",
            role="command",
            dir_="tx",
            sub=0x01,
            checksum="none",
        ),
        mdb_cmd(
            0x0F,
            "CoinPayoutStatus",
            "硬币器找零状态",
            role="command",
            dir_="tx",
            sub=0x03,
            checksum="none",
        ),
        mdb_cmd(
            0x0F,
            "CoinPayoutValue",
            "硬币器找零金额轮询",
            role="command",
            dir_="tx",
            sub=0x04,
            checksum="none",
        ),
        mdb_cmd(
            0x0F,
            "CoinAltPayout",
            "硬币器找零",
            role="command",
            dir_="tx",
            sub=0x02,
            checksum="none",
        ),
        # Bill
        mdb_cmd(0x30, "BillReset", "纸币器重置", role="command", dir_="tx", checksum="none"),
        mdb_cmd(0x31, "BillSetup", "纸币器初始化", role="command", dir_="tx", checksum="none"),
        mdb_cmd(
            0x31,
            "BillSetupReply",
            "纸币器初始化应答",
            role="reply",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(0x33, "BillPoll", "纸币器轮询", role="command", dir_="tx", checksum="none"),
        mdb_cmd(
            0x34,
            "BillEnable",
            "纸币器开始收钱",
            role="command",
            dir_="tx",
            checksum="none",
        ),
        mdb_cmd(
            0x37,
            "BillFeature",
            "纸币器扩展功能",
            role="command",
            dir_="tx",
            sub=0x01,
            checksum="none",
        ),
        mdb_cmd(
            0x37,
            "BillRecyclerSetup",
            "纸币器回收单元",
            role="command",
            dir_="tx",
            sub=0x03,
            checksum="none",
        ),
        mdb_cmd(
            0x37,
            "BillDispenseStatus",
            "纸币器找零状态",
            role="command",
            dir_="tx",
            sub=0x05,
            checksum="none",
        ),
        # Reports (device base + event)
        mdb_cmd(
            0x10,
            "ClReport",
            "刷卡器主动上报",
            role="report",
            dir_="rx",
            checksum="none",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x08,
            "CoinReport",
            "硬币器主动上报",
            role="report",
            dir_="rx",
            checksum="none",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x30,
            "BillReport",
            "纸币器主动上报",
            role="report",
            dir_="rx",
            checksum="none",
            decode=[hex_dump()],
        ),
        # Poll events without device prefix
        mdb_cmd(
            0x00,
            "ClJustReset",
            "刷卡器复位事件",
            role="event",
            dir_="rx",
            checksum="none",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x01,
            "ClBeginSession",
            "刷卡器开始会话事件",
            role="event",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x03,
            "ClVendApproved",
            "刷卡器出货批准",
            role="event",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x04,
            "ClVendDenied",
            "刷卡器出货拒绝",
            role="event",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x05,
            "ClEndSession",
            "刷卡器会话结束事件",
            role="event",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x06,
            "ClCancelled",
            "刷卡器取消事件",
            role="event",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
        mdb_cmd(
            0x07,
            "ClMalfunction",
            "刷卡器故障事件",
            role="event",
            dir_="rx",
            checksum="sum8_tail",
            decode=[hex_dump()],
        ),
    ]
    return out


def main() -> None:
    # AA55: payment first (more specific lens), then VMC.
    # MDB entries all have role.
    commands = pay_commands() + vmc_commands() + mdb_commands()
    pack = {
        "id": "gaosheng-jk",
        "name": "高盛 JK 混合串口",
        "version": "1.0.0",
        "presentation": "decoded",
        "ai": {
            "summary": (
                "解析高盛咖啡机主控 AA55、支付板 V1/V2 AA55 与 MDB-RS232 裸帧。"
                "帧头 AA55/A55A 走定长帧（按命令字+整帧长度+载荷前缀匹配）；"
                "其余十六进制走 MDB。覆盖 Device/Payment/Coffee-Machine 行。"
            )
        },
        "filters": [
            {"id": "all", "label": "全部"},
            {"id": "tx", "label": "发送"},
            {"id": "rx", "label": "接收"},
        ],
        "line_rules": [
            {
                "id": "device-arrow",
                "pattern": r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+Device:\S+\s+([><])\s+([0-9A-Fa-f ]+)$",
                "dir_group": 2,
                "dir_map": {">": "tx", "<": "rx"},
                "hex_group": 3,
                "time_group": 1,
            },
            {
                "id": "payment-arrow",
                "pattern": r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+Payment:\S+\s+([><])\s+([0-9A-Fa-f ]+)$",
                "dir_group": 2,
                "dir_map": {">": "tx", "<": "rx"},
                "hex_group": 3,
                "time_group": 1,
            },
            {
                "id": "coffee-cn",
                "pattern": r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+Coffee-Machine:\S*?---(发送|接收)：\s*([0-9A-Fa-f ]+)$",
                "dir_group": 2,
                "dir_map": {"发送": "tx", "接收": "rx"},
                "hex_group": 3,
                "time_group": 1,
            },
        ],
        "frame": {
            "kind": "mixed",
            "tx_header": [170, 85],
            "rx_header": [165, 90],
            "checksum": "sum8_before_last",
            "device_bases": [8, 16, 24, 48, 64, 72, 80, 88, 96, 104, 112],
        },
        "commands": commands,
        "examples": [
            {
                "input": "2026-08-14 15:34:58.529 Payment:/dev/ttyS9 > AA 55 02 20 21",
                "note": "支付读状态",
            },
            {
                "input": "2026-08-14 15:35:00.000 Device:/dev/ttyS7 > AA 55 08 20 01 03 02 23 00 06 56",
                "note": "主控旧固件",
            },
            {
                "input": "2026-08-17 10:41:36.684 Payment:/dev/ttyS9 > 11 00 03 00 00 00",
                "note": "MDB 刷卡器 Setup",
            },
        ],
    }
    OUT.write_text(json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} commands={len(commands)}")


if __name__ == "__main__":
    main()
