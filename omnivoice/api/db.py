import sqlite3
import json
import uuid
import time
from pathlib import Path
from typing import List, Dict, Optional, Any

DATA_DIR = Path("data")
DB_PATH = DATA_DIR / "tasks.db"
OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)


def get_db_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=60.0, check_same_thread=False)
    conn.execute("PRAGMA busy_timeout = 60000;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = get_db_connection()
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        cursor = conn.cursor()

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS voice_tasks (
            id TEXT PRIMARY KEY,
            order_num INTEGER,
            task_type TEXT NOT NULL,
            text TEXT NOT NULL,
            voice_id TEXT,
            voice_name TEXT,
            language TEXT DEFAULT 'Auto',
            instruct TEXT,
            params_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            progress INTEGER DEFAULT 0,
            audio_url TEXT,
            filename TEXT,
            duration_sec REAL,
            generation_time_sec REAL,
            error_message TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        )
        """)

        # Add columns if they do not already exist
        for col, col_type in [
            ("batch_id", "TEXT"),
            ("parent_id", "TEXT"),
            ("is_master", "INTEGER DEFAULT 1"),
            ("total_chunks", "INTEGER DEFAULT 1"),
            ("completed_chunks", "INTEGER DEFAULT 0"),
            ("gap_sec", "REAL DEFAULT 0.8"),
        ]:
            try:
                cursor.execute(f"ALTER TABLE voice_tasks ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON voice_tasks (status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_order ON voice_tasks (order_num)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_created ON voice_tasks (created_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_batch ON voice_tasks (batch_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON voice_tasks (parent_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_is_master ON voice_tasks (is_master)")

        # Create table for merged audio batches
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS merged_batches (
            id TEXT PRIMARY KEY,
            batch_id TEXT UNIQUE,
            title TEXT,
            audio_url TEXT NOT NULL,
            filename TEXT NOT NULL,
            duration_sec REAL,
            chunks_count INTEGER,
            gap_sec REAL DEFAULT 0.8,
            created_at TEXT NOT NULL
        )
        """)

        # Reset any tasks stuck in 'processing' when server was shut down/restarted
        cursor.execute("""
        UPDATE voice_tasks 
        SET status = 'pending', started_at = NULL 
        WHERE status = 'processing'
        """)

        conn.commit()
    finally:
        conn.close()


def _get_next_order_num(cursor: sqlite3.Cursor) -> int:
    cursor.execute("SELECT MAX(order_num) FROM voice_tasks")
    row = cursor.fetchone()
    if row and row[0] is not None:
        return row[0] + 1
    return 1


def create_task(
    task_type: str,
    text: str,
    voice_id: Optional[str] = None,
    voice_name: Optional[str] = None,
    language: str = "Auto",
    instruct: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    status: str = "pending",
    batch_id: Optional[str] = None,
    parent_id: Optional[str] = None,
    is_master: int = 1,
    total_chunks: int = 1,
    completed_chunks: int = 0,
    gap_sec: float = 0.8,
) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()

    task_id = f"task_{uuid.uuid4().hex[:10]}"
    order_num = _get_next_order_num(cursor)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    params_json = json.dumps(params or {}, ensure_ascii=False)

    cursor.execute(
        """
        INSERT INTO voice_tasks (
            id, order_num, task_type, text, voice_id, voice_name,
            language, instruct, params_json, status, progress, batch_id,
            parent_id, is_master, total_chunks, completed_chunks, gap_sec, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task_id,
            order_num,
            task_type,
            text.strip(),
            voice_id,
            voice_name,
            language,
            instruct.strip() if instruct else None,
            params_json,
            status,
            batch_id,
            parent_id,
            is_master,
            total_chunks,
            completed_chunks,
            gap_sec,
            now,
        ),
    )

    conn.commit()
    task = get_task(task_id, conn=conn)
    conn.close()
    return task


def create_long_form_master_task(
    text: str,
    voice_id: str,
    voice_name: Optional[str] = None,
    language: str = "Auto",
    instruct: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    chunk_size: int = 1000,
    gap_sec: float = 0.8,
) -> Dict[str, Any]:
    """
    Creates ONE master task representing the whole transcript.
    Splits text into coherent chunks (~1000 chars ending at full sentences).
    Creates sub-tasks for each chunk. The master task tracks overall progress
    and will be automatically merged into 1 audio file upon completion.
    """
    from omnivoice.api.audio_ops import split_text_by_sentence_chunks

    text = text.strip()
    if not text:
        raise ValueError("Text cannot be empty.")

    chunks = split_text_by_sentence_chunks(text, target_chars=chunk_size)
    if not chunks:
        chunks = [text]

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        master_id = f"task_{uuid.uuid4().hex[:10]}"
        order_num = _get_next_order_num(cursor)
        now = time.strftime("%Y-%m-%d %H:%M:%S")

        params_dict = dict(params or {})
        params_dict["chunk_size"] = chunk_size
        params_dict["gap_sec"] = gap_sec
        params_dict["total_chunks"] = len(chunks)
        params_json = json.dumps(params_dict, ensure_ascii=False)

        # 1. Insert Master Task (is_master = 1)
        cursor.execute(
            """
            INSERT INTO voice_tasks (
                id, order_num, task_type, text, voice_id, voice_name,
                language, instruct, params_json, status, progress, batch_id,
                parent_id, is_master, total_chunks, completed_chunks, gap_sec, created_at
            ) VALUES (?, ?, 'clone', ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, 1, ?, 0, ?, ?)
            """,
            (
                master_id,
                order_num,
                text,
                voice_id,
                voice_name,
                language,
                instruct.strip() if instruct else None,
                params_json,
                len(chunks),
                gap_sec,
                now,
            ),
        )

        # 2. If len(chunks) > 1, create sub-tasks for each chunk (is_master = 0)
        if len(chunks) > 1:
            for i, chunk_text in enumerate(chunks):
                sub_id = f"sub_{uuid.uuid4().hex[:10]}"
                sub_params = dict(params_dict)
                sub_params["chunk_index"] = i
                sub_params["total_chunks"] = len(chunks)
                sub_params_json = json.dumps(sub_params, ensure_ascii=False)

                cursor.execute(
                    """
                    INSERT INTO voice_tasks (
                        id, order_num, task_type, text, voice_id, voice_name,
                        language, instruct, params_json, status, progress, batch_id,
                        parent_id, is_master, total_chunks, completed_chunks, gap_sec, created_at
                    ) VALUES (?, ?, 'clone', ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, 0, 1, 0, ?, ?)
                    """,
                    (
                        sub_id,
                        order_num,
                        chunk_text,
                        voice_id,
                        voice_name,
                        language,
                        instruct.strip() if instruct else None,
                        sub_params_json,
                        master_id,
                        gap_sec,
                        now,
                    ),
                )

        conn.commit()
        master_task = get_task(master_id, conn=conn)
        return master_task
    finally:
        conn.close()


def update_master_task_progress(master_id: str) -> Optional[Dict[str, Any]]:
    """
    Updates the overall progress of a master task based on its sub-chunks.
    When all sub-chunks are completed, automatically merges them into a single audio file with gap_sec.
    """
    from omnivoice.api.audio_ops import merge_audio_files

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM voice_tasks WHERE id = ?", (master_id,))
        master_row = cursor.fetchone()
        if not master_row:
            return None
        master = dict(master_row)

        cursor.execute("SELECT * FROM voice_tasks WHERE parent_id = ? ORDER BY rowid ASC", (master_id,))
        sub_rows = cursor.fetchall()
        if not sub_rows:
            return master

        sub_tasks = [dict(r) for r in sub_rows]
        total = len(sub_tasks)
        completed = sum(1 for t in sub_tasks if t["status"] == "completed")
        failed = sum(1 for t in sub_tasks if t["status"] == "failed")
        progress = int((completed / total) * 100) if total > 0 else 0

        now = time.strftime("%Y-%m-%d %H:%M:%S")

        # If all sub-chunks are completed, merge audio!
        if completed == total:
            file_paths = []
            for t in sub_tasks:
                if t.get("filename"):
                    fp = OUTPUTS_DIR / t["filename"]
                    if fp.exists():
                        file_paths.append(fp)

            gap_sec = master.get("gap_sec") or 0.8
            output_filename = f"merged_{master_id}.wav"
            output_path = OUTPUTS_DIR / output_filename

            duration_sec, sr = merge_audio_files(file_paths, output_path, gap_sec=gap_sec)
            audio_url = f"/api/audio/output_{output_filename}"

            total_gen_time = round(sum(t.get("generation_time_sec") or 0.0 for t in sub_tasks), 2)
            if total_gen_time <= 0 and master.get("started_at"):
                try:
                    t_start = time.mktime(time.strptime(master["started_at"], "%Y-%m-%d %H:%M:%S"))
                    t_end = time.mktime(time.strptime(now, "%Y-%m-%d %H:%M:%S"))
                    total_gen_time = round(max(0.0, t_end - t_start), 2)
                except Exception:
                    pass

            cursor.execute(
                """
                UPDATE voice_tasks
                SET status = 'completed', progress = 100, completed_chunks = ?,
                    audio_url = ?, filename = ?, duration_sec = ?, 
                    generation_time_sec = ?, completed_at = ?
                WHERE id = ?
                """,
                (completed, audio_url, output_filename, duration_sec, total_gen_time, now, master_id),
            )
        elif failed > 0 and (completed + failed == total):
            cursor.execute(
                """
                UPDATE voice_tasks
                SET status = 'failed', progress = ?, completed_chunks = ?,
                    error_message = ?, completed_at = ?
                WHERE id = ?
                """,
                (progress, completed, f"{failed} đoạn bị lỗi", now, master_id),
            )
        else:
            # Still in progress
            cursor.execute(
                """
                UPDATE voice_tasks
                SET status = 'processing', progress = ?, completed_chunks = ?,
                    started_at = COALESCE(started_at, ?)
                WHERE id = ?
                """,
                (progress, completed, now, master_id),
            )

        conn.commit()
        return get_task(master_id, conn=conn)
    finally:
        conn.close()


def create_batch_tasks(
    items: List[Dict[str, Any]],
    common_type: str = "clone",
    common_voice_id: Optional[str] = None,
    common_voice_name: Optional[str] = None,
    common_language: str = "Auto",
    common_instruct: Optional[str] = None,
    common_params: Optional[Dict[str, Any]] = None,
    batch_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Creates multiple tasks in a single database transaction.
    Each item can have {'text': ..., 'instruct': ..., etc.}
    """
    conn = get_db_connection()
    try:
        cursor = conn.cursor()

        created_tasks = []
        base_order = _get_next_order_num(cursor)
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        assigned_batch_id = batch_id or f"batch_{uuid.uuid4().hex[:10]}"

        for i, item in enumerate(items):
            text = item.get("text", "").strip()
            if not text:
                continue

            task_id = f"task_{uuid.uuid4().hex[:10]}"
            order_num = base_order + i
            t_type = item.get("task_type") or common_type or "clone"
            v_id = item.get("voice_id") or common_voice_id
            v_name = item.get("voice_name") or common_voice_name
            lang = item.get("language") or common_language or "Auto"
            inst = item.get("instruct") or common_instruct
            if inst:
                inst = inst.strip()

            # Merge params
            p = dict(common_params or {})
            if "params" in item and isinstance(item["params"], dict):
                p.update(item["params"])
            params_json = json.dumps(p, ensure_ascii=False)

            cursor.execute(
                """
                INSERT INTO voice_tasks (
                    id, order_num, task_type, text, voice_id, voice_name,
                    language, instruct, params_json, status, progress, batch_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
                """,
                (
                    task_id,
                    order_num,
                    t_type,
                    text,
                    v_id,
                    v_name,
                    lang,
                    inst,
                    params_json,
                    assigned_batch_id,
                    now,
                ),
            )

            created_tasks.append(task_id)

        conn.commit()

        # Retrieve all created tasks
        results = []
        for tid in created_tasks:
            t = get_task(tid, conn=conn)
            if t:
                results.append(t)

        return results
    finally:
        conn.close()


def get_task(task_id: str, conn: Optional[sqlite3.Connection] = None) -> Optional[Dict[str, Any]]:
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True

    cursor = conn.cursor()
    cursor.execute("SELECT * FROM voice_tasks WHERE id = ?", (task_id,))
    row = cursor.fetchone()

    res = None
    if row:
        res = dict(row)
        if res.get("params_json"):
            try:
                res["params"] = json.loads(res["params_json"])
            except Exception:
                res["params"] = {}
        else:
            res["params"] = {}

    if should_close:
        conn.close()
    return res


def list_tasks(
    status: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    master_only: bool = True,
) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = []
    params = []

    if master_only:
        conditions.append("(is_master = 1 OR is_master IS NULL)")

    if status and status != "all":
        conditions.append("status = ?")
        params.append(status)

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"""
        SELECT * FROM voice_tasks 
        {where_sql}
        ORDER BY order_num DESC 
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])
    cursor.execute(query, tuple(params))

    rows = cursor.fetchall()
    tasks = []
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks.append(t)

    conn.close()
    return tasks


def get_next_pending_task() -> Optional[Dict[str, Any]]:
    """Finds the earliest pending task to execute (FIFO by order_num).
    Only selects executable sub-tasks or standalone single tasks.
    Container master tasks with multiple sub-chunks are processed via their chunks.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT * FROM voice_tasks 
        WHERE status = 'pending' AND (is_master = 0 OR total_chunks = 1 OR total_chunks IS NULL)
        ORDER BY order_num ASC, rowid ASC 
        LIMIT 1
        """
    )
    row = cursor.fetchone()
    res = None
    if row:
        res = dict(row)
        if res.get("params_json"):
            try:
                res["params"] = json.loads(res["params_json"])
            except Exception:
                res["params"] = {}
        else:
            res["params"] = {}
    conn.close()
    return res


def update_task_status(
    task_id: str,
    status: str,
    progress: Optional[int] = None,
    audio_url: Optional[str] = None,
    filename: Optional[str] = None,
    duration_sec: Optional[float] = None,
    generation_time_sec: Optional[float] = None,
    error_message: Optional[str] = None,
    started: bool = False,
    completed: bool = False,
) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()

    updates = ["status = ?"]
    params: List[Any] = [status]

    if progress is not None:
        updates.append("progress = ?")
        params.append(progress)
    if audio_url is not None:
        updates.append("audio_url = ?")
        params.append(audio_url)
    if filename is not None:
        updates.append("filename = ?")
        params.append(filename)
    if duration_sec is not None:
        updates.append("duration_sec = ?")
        params.append(round(duration_sec, 2))
    if generation_time_sec is not None:
        updates.append("generation_time_sec = ?")
        params.append(round(generation_time_sec, 2))
    if error_message is not None:
        updates.append("error_message = ?")
        params.append(error_message)

    now = time.strftime("%Y-%m-%d %H:%M:%S")
    if started:
        updates.append("started_at = ?")
        params.append(now)
    if completed:
        updates.append("completed_at = ?")
        params.append(now)

    params.append(task_id)
    if status == "processing":
        sql = f"UPDATE voice_tasks SET {', '.join(updates)} WHERE id = ? AND status NOT IN ('completed', 'failed', 'cancelled')"
    else:
        sql = f"UPDATE voice_tasks SET {', '.join(updates)} WHERE id = ?"
    cursor.execute(sql, tuple(params))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def retry_task(task_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE voice_tasks 
        SET status = 'pending', progress = 0, error_message = NULL,
            audio_url = NULL, filename = NULL, started_at = NULL, completed_at = NULL 
        WHERE id = ? AND status IN ('failed', 'cancelled')
        """,
        (task_id,),
    )
    conn.commit()
    conn.close()
    return get_task(task_id)


def cancel_task(task_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE voice_tasks 
        SET status = 'cancelled', completed_at = ? 
        WHERE id = ? AND status = 'pending'
        """,
        (time.strftime("%Y-%m-%d %H:%M:%S"), task_id),
    )
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def delete_task(task_id: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM voice_tasks WHERE id = ? OR parent_id = ?", (task_id, task_id))
    affected = cursor.rowcount
    conn.commit()
    conn.close()
    return affected > 0


def clear_completed_tasks(master_only: bool = True) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id FROM voice_tasks WHERE status IN ('completed', 'failed', 'cancelled') AND (is_master = 1 OR is_master IS NULL)"
    )
    rows = cursor.fetchall()
    if not rows:
        conn.close()
        return 0

    ids = [r[0] for r in rows]
    placeholders = ",".join(["?"] * len(ids))
    cursor.execute(f"DELETE FROM voice_tasks WHERE parent_id IN ({placeholders})", ids)
    cursor.execute(f"DELETE FROM voice_tasks WHERE id IN ({placeholders})", ids)
    count = len(ids)
    conn.commit()
    conn.close()
    return count


def get_task_stats(master_only: bool = True) -> Dict[str, int]:
    conn = get_db_connection()
    cursor = conn.cursor()
    where_sql = "WHERE (is_master = 1 OR is_master IS NULL)" if master_only else ""
    cursor.execute(
        f"""
        SELECT status, COUNT(*) as count 
        FROM voice_tasks 
        {where_sql}
        GROUP BY status
        """
    )
    rows = cursor.fetchall()
    stats = {
        "total": 0,
        "pending": 0,
        "processing": 0,
        "completed": 0,
        "failed": 0,
        "cancelled": 0,
    }
    total = 0
    for r in rows:
        st = r["status"]
        cnt = r["count"]
        total += cnt
        if st in stats:
            stats[st] = cnt

    stats["total"] = total
    conn.close()
    return stats


def get_sub_tasks(master_id: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM voice_tasks WHERE parent_id = ? ORDER BY rowid ASC",
        (master_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    tasks = []
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks.append(t)
    return tasks


def get_tasks_by_ids(task_ids: List[str]) -> List[Dict[str, Any]]:
    """Retrieves tasks corresponding to the given IDs in the exact order requested"""
    if not task_ids:
        return []
    conn = get_db_connection()
    cursor = conn.cursor()
    placeholders = ",".join(["?"] * len(task_ids))
    cursor.execute(f"SELECT * FROM voice_tasks WHERE id IN ({placeholders})", task_ids)
    rows = cursor.fetchall()
    conn.close()

    tasks_map = {}
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks_map[t["id"]] = t

    return [tasks_map[tid] for tid in task_ids if tid in tasks_map]


def get_tasks_by_batch_id(batch_id: str) -> List[Dict[str, Any]]:
    """Retrieves all tasks in a batch ordered by order_num ASC"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM voice_tasks WHERE batch_id = ? ORDER BY order_num ASC",
        (batch_id,),
    )
    rows = cursor.fetchall()
    conn.close()

    tasks = []
    for r in rows:
        t = dict(r)
        if t.get("params_json"):
            try:
                t["params"] = json.loads(t["params_json"])
            except Exception:
                t["params"] = {}
        else:
            t["params"] = {}
        tasks.append(t)
    return tasks


def save_merged_batch(
    batch_id: str,
    title: str,
    audio_url: str,
    filename: str,
    duration_sec: float,
    chunks_count: int,
    gap_sec: float = 0.8,
) -> Dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    record_id = f"merge_{uuid.uuid4().hex[:10]}"
    now = time.strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute(
        """
        INSERT OR REPLACE INTO merged_batches (
            id, batch_id, title, audio_url, filename, duration_sec, chunks_count, gap_sec, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record_id,
            batch_id,
            title,
            audio_url,
            filename,
            duration_sec,
            chunks_count,
            gap_sec,
            now,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "id": record_id,
        "batch_id": batch_id,
        "title": title,
        "audio_url": audio_url,
        "filename": filename,
        "duration_sec": duration_sec,
        "chunks_count": chunks_count,
        "gap_sec": gap_sec,
        "created_at": now,
    }


def get_merged_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM merged_batches WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1", (batch_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def list_merged_batches(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM merged_batches ORDER BY created_at DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

